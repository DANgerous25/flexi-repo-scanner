"""Task executor — runs scan tasks and processes results."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from backend.config import AppSettings, TaskConfig
from backend.scanner.github import GitHubClient, GitHubFile, filter_files
from backend.scanner.pattern import Finding, scan_file_content
from backend.scanner.llm_review import review_files
from backend.scanner.doc_coverage import scan_doc_coverage
from backend.storage import config_loader, db
from backend.actions import email_report, github_issue, generate_prompt, in_app_notify

logger = logging.getLogger(__name__)


async def run_task(task: TaskConfig, settings: AppSettings) -> str:
    """Execute a scan task. Returns run_id."""
    conn = config_loader.get_connection(task.connection)
    if not conn:
        raise ValueError(f"Connection '{task.connection}' not found")

    run_id = await db.create_run(task.id, task.scan.mode)
    await db.upsert_task_state(task.id, status="running", last_run_id=run_id)

    client = GitHubClient(owner=conn.owner, repo=conn.repo, token=conn.token)

    try:
        branch = conn.default_branch or await client.get_default_branch()
        latest_sha = await client.get_latest_commit_sha(branch)

        # Get files to scan
        if task.scan.mode == "diff":
            state = await db.get_task_state(task.id)
            last_sha = state.get("last_commit_sha", "") if state else ""
            if last_sha and last_sha != latest_sha:
                changed = await client.get_compare(last_sha, latest_sha)
                all_files = [
                    GitHubFile(path=f["filename"], sha=f["sha"], size=0)
                    for f in changed if f["status"] != "removed"
                ]
            else:
                # No previous SHA or same commit — do full scan
                all_files = await client.list_files(branch)
        else:
            all_files = await client.list_files(branch)

        # Filter files
        include = task.scan.paths.get("include", ["**/*"])
        exclude = task.scan.paths.get("exclude", [])
        files = filter_files(all_files, include, exclude)

        await db.update_run(run_id, total_files=len(files))

        # Execute scan based on type
        all_findings: list[dict] = []

        if task.scan.type == "pattern":
            all_findings = await _run_pattern_scan(client, branch, files, task, run_id)
        elif task.scan.type == "llm-review":
            all_findings = await _run_llm_scan(client, branch, files, task, settings, run_id)
        elif task.scan.type == "doc-coverage":
            all_findings = await _run_doc_scan(client, branch, files, task, settings, run_id)

        # Save findings
        await db.insert_findings(all_findings)
        await db.complete_run(
            run_id,
            finding_count=len(all_findings),
            total_files=len(all_files),
            scanned_files=len(files),
            last_commit_sha=latest_sha,
        )
        await db.upsert_task_state(
            task.id, status="completed", last_commit_sha=latest_sha
        )

        # Execute actions
        await _run_actions(task, settings, run_id, all_findings, conn)

        logger.info(f"Task {task.id} completed: {len(all_findings)} findings in {len(files)} files")
        return run_id

    except Exception as e:
        logger.error(f"Task {task.id} failed: {e}")
        await db.fail_run(run_id, str(e))
        await db.upsert_task_state(task.id, status="failed")
        raise
    finally:
        await client.close()


async def _run_pattern_scan(
    client: GitHubClient,
    branch: str,
    files: list[GitHubFile],
    task: TaskConfig,
    run_id: str,
) -> list[dict]:
    """Run regex pattern scan across files."""
    findings = []
    scanned = 0

    for file in files:
        content = await client.get_file_content(file.path, ref=branch)
        if content is None:
            continue

        scanned += 1
        file_findings = scan_file_content(
            file.path, content,
            task.scan.rules,
            task.scan.allowlist,
            task.scan.context_filters,
        )

        for f in file_findings:
            findings.append({
                "run_id": run_id,
                "task_id": task.id,
                "category": f.category,
                "file_path": f.file_path,
                "line_number": f.line_number,
                "severity": f.severity,
                "rule_id": f.rule_id,
                "description": f.description,
                "matched_text": f.matched_text,
                "context": f.context,
            })

        if scanned % 20 == 0:
            await db.update_run(run_id, scanned_files=scanned)

    return findings


async def _run_llm_scan(
    client: GitHubClient,
    branch: str,
    files: list[GitHubFile],
    task: TaskConfig,
    settings: AppSettings,
    run_id: str,
) -> list[dict]:
    """Run LLM-powered scan across files."""
    findings = []
    max_files = task.scan.llm.max_files_per_run or 50
    batch_size = 5  # Files per LLM call

    scan_files = files[:max_files]
    file_contents: dict[str, str] = {}

    for file in scan_files:
        content = await client.get_file_content(file.path, ref=branch)
        if content:
            file_contents[file.path] = content

    # Process in batches
    paths = list(file_contents.keys())
    for i in range(0, len(paths), batch_size):
        batch_paths = paths[i:i + batch_size]
        batch = {p: file_contents[p] for p in batch_paths}

        result = await review_files(
            batch, task.scan.llm, settings, task.scan.llm.focus
        )

        for f in result.get("findings", []):
            findings.append({
                "run_id": run_id,
                "task_id": task.id,
                "category": f.get("category", "LLM Review"),
                "file_path": f.get("file", ""),
                "line_number": f.get("line", 0),
                "severity": f.get("severity", "medium"),
                "rule_id": "llm-review",
                "description": f.get("description", ""),
                "matched_text": f.get("suggestion", ""),
                "context": f.get("description", ""),
            })

        await db.update_run(run_id, scanned_files=min(i + batch_size, len(paths)))

    return findings


async def _run_doc_scan(
    client: GitHubClient,
    branch: str,
    files: list[GitHubFile],
    task: TaskConfig,
    settings: AppSettings,
    run_id: str,
) -> list[dict]:
    """Run documentation coverage scan."""
    findings = []
    scanned = 0

    for file in files:
        content = await client.get_file_content(file.path, ref=branch)
        if content is None:
            continue

        scanned += 1
        file_findings = scan_doc_coverage(file.path, content)

        for f in file_findings:
            findings.append({
                "run_id": run_id,
                "task_id": task.id,
                "category": f.category,
                "file_path": f.file_path,
                "line_number": f.line_number,
                "severity": f.severity,
                "rule_id": f.rule_id,
                "description": f.description,
                "matched_text": f.matched_text,
                "context": f.context,
            })

        if scanned % 20 == 0:
            await db.update_run(run_id, scanned_files=scanned)

    return findings


async def _run_actions(
    task: TaskConfig,
    settings: AppSettings,
    run_id: str,
    findings: list[dict],
    conn: Any,
) -> None:
    """Execute post-scan actions."""
    has_findings = len(findings) > 0

    for action in task.actions:
        should_run = (
            action.trigger == "always"
            or (action.trigger == "findings" and has_findings)
        )
        if not should_run:
            continue

        try:
            if action.type == "email-report":
                await email_report.send(task, run_id, findings, action.recipients, settings)
            elif action.type == "github-issue":
                await github_issue.create(task, run_id, findings, conn, action)
            elif action.type in ("generate-fix-prompt", "generate-prompt"):
                await generate_prompt.generate(task, run_id, findings)
            elif action.type == "in-app-notify":
                await in_app_notify.notify(task, run_id, findings)
        except Exception as e:
            logger.error(f"Action {action.type} failed for task {task.id}: {e}")
