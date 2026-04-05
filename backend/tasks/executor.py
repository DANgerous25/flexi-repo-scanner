print("EXECUTOR.PY VERSION 2026-04-05T13:15:01")

"""Task executor — runs scan tasks and processes results."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any, Optional

import tree_sitter
from tree_sitter_python import language as python_language
from tree_sitter_javascript import language as javascript_language
from tree_sitter_typescript import language as typescript_language

from backend.config import AppSettings, TaskConfig, AstRule, AstNodePattern
from backend.scanner.github import GitHubClient, GitHubFile, filter_files
from backend.scanner.pattern import Finding, scan_file_content
from backend.scanner.llm_review import review_files
from backend.scanner.doc_coverage import scan_doc_coverage
from backend.storage import config_loader, db
from backend.actions import email_report, github_issue, generate_prompt, in_app_notify

logger = logging.getLogger(__name__)

_running_runs: dict[str, asyncio.Task] = {}
_parsers: dict[str, tree_sitter.Parser] = {}

def _get_parser_for_file(file_path: str) -> Optional[tree_sitter.Parser]:
    """Get a pre-initialized tree-sitter parser for a given file extension."""
    ext = os.path.splitext(file_path)[1]
    if ext not in _parsers:
        lang_map = {
            ".py": python_language,
            ".js": javascript_language,
            ".ts": typescript_language,
        }
        language_func = lang_map.get(ext)
        if not language_func:
            return None
        try:
            parser = tree_sitter.Parser()
            parser.set_language(language_func())
            _parsers[ext] = parser
        except Exception as e:
            logger.error(f"Failed to load tree-sitter parser for extension {ext}: {e}")
            return None
    return _parsers.get(ext)

def _match_ast_node(
    node: Any, pattern: AstNodePattern, content_bytes: bytes
) -> bool:
    if pattern.node_type and node.type != pattern.node_type:
        return False
    if pattern.value_regex:
        node_text = node.text.decode("utf8", "ignore")
        if not re.search(pattern.value_regex, node_text):
            return False
    return True

class TaskCancelled(Exception):
    """Raised when a run is cancelled or stopped via the API."""

async def _check_cancelled(run_id: str) -> bool:
    status = await db.get_run_status(run_id)
    return status in ("cancelled", "failed")

async def run_task(task: TaskConfig, settings: AppSettings) -> str:
    conn = config_loader.get_connection(task.connection)
    if not conn:
        raise ValueError(f"Connection '{task.connection}' not found")

    run_id = await db.create_run(task.id, task.scan.mode)
    await db.upsert_task_state(task.id, status="running", last_run_id=run_id)

    current_task = asyncio.current_task()
    if current_task:
        _running_runs[run_id] = current_task

    client = GitHubClient(owner=conn.owner, repo=conn.repo, token=conn.token)
    try:
        branch = conn.default_branch or await client.get_default_branch()
        latest_sha = await client.get_latest_commit_sha(branch)

        if task.scan.mode == "diff":
            state = await db.get_task_state(task.id)
            last_sha = state.get("last_commit_sha", "") if state else ""
            if last_sha and last_sha != latest_sha:
                changed = await client.get_compare(last_sha, latest_sha)
                all_files = [GitHubFile(path=f["filename"], sha=f["sha"], size=0) for f in changed if f["status"] != "removed"]
            else:
                all_files = await client.list_files(branch)
        else:
            all_files = await client.list_files(branch)

        include = task.scan.paths.get("include", ["**/*"])
        exclude = task.scan.paths.get("exclude", [])
        files = filter_files(all_files, include, exclude)
        await db.update_run(run_id, total_files=len(files))

        if await _check_cancelled(run_id):
            raise TaskCancelled(f"Run {run_id} cancelled")

        all_findings: list[dict] = []
        if task.scan.type == "pattern":
            all_findings = await _run_pattern_scan(client, branch, files, task, run_id)
        elif task.scan.type == "ast-pattern":
            all_findings = await _run_ast_pattern_scan(client, branch, files, task, run_id)
        elif task.scan.type == "llm-review":
            all_findings = await _run_llm_scan(client, branch, files, task, settings, run_id)
        elif task.scan.type == "doc-coverage":
            all_findings = await _run_doc_scan(client, branch, files, task, settings, run_id)

        await db.insert_findings(all_findings)
        await db.complete_run(run_id, finding_count=len(all_findings), total_files=len(all_files), scanned_files=len(files), last_commit_sha=latest_sha)
        await db.upsert_task_state(task.id, status="completed", last_commit_sha=latest_sha)
        await _run_actions(task, settings, run_id, all_findings, conn)
        logger.info(f"Task {task.id} completed: {len(all_findings)} findings in {len(files)} files")
        return run_id
    except (TaskCancelled, asyncio.CancelledError) as e:
        logger.info(f"Task {task.id} run {run_id} was cancelled: {e}")
        return run_id
    except Exception as e:
        logger.error(f"Task {task.id} failed: {e}", exc_info=True)
        await db.fail_run(run_id, str(e))
        await db.upsert_task_state(task.id, status="failed")
        raise
    finally:
        _running_runs.pop(run_id, None)
        await client.close()

async def _run_pattern_scan(client: GitHubClient, branch: str, files: list[GitHubFile], task: TaskConfig, run_id: str) -> list[dict]:
    findings = []
    scanned = 0
    for file in files:
        content = await client.get_file_content(file.path, ref=branch)
        if content is None: continue
        scanned += 1
        for f in scan_file_content(file.path, content, task.scan.rules, task.scan.allowlist, task.scan.context_filters):
            findings.append({"run_id": run_id, "task_id": task.id, **f.model_dump()})
        if scanned % 20 == 0:
            await db.update_run(run_id, scanned_files=scanned)
            if await _check_cancelled(run_id): raise TaskCancelled(f"Run {run_id} cancelled")
    return findings

async def _run_ast_pattern_scan(client: GitHubClient, branch: str, files: list[GitHubFile], task: TaskConfig, run_id: str) -> list[dict]:
    findings = []
    scanned = 0
    for file in files:
        parser = _get_parser_for_file(file.path)
        if not parser: continue
        content = await client.get_file_content(file.path, ref=branch)
        if content is None: continue
        scanned += 1
        try:
            tree = parser.parse(content.encode("utf8"))
            queue = [tree.root_node]
            while queue:
                node = queue.pop(0)
                for rule in task.scan.ast_rules:
                    if _match_ast_node(node, rule.pattern, content.encode("utf8")):
                        findings.append({
                            "run_id": run_id,
                            "task_id": task.id,
                            "category": "AST Pattern",
                            "file_path": file.path,
                            "line_number": node.start_point[0] + 1,
                            "severity": rule.severity,
                            "rule_id": rule.id,
                            "description": rule.description or rule.name,
                            "matched_text": node.text.decode("utf8", "ignore"),
                            "context": node.parent.text.decode("utf8", "ignore") if node.parent else "",
                        })
                if node.children:
                    queue.extend(node.children)
        except Exception as e:
            logger.warning(f"Failed to parse or scan file {file.path} with AST: {e}")
        if scanned % 20 == 0:
            await db.update_run(run_id, scanned_files=scanned)
            if await _check_cancelled(run_id): raise TaskCancelled(f"Run {run_id} cancelled")
    return findings

async def _run_llm_scan(client: GitHubClient, branch: str, files: list[GitHubFile], task: TaskConfig, settings: AppSettings, run_id: str) -> list[dict]:
    # Implementation omitted for brevity
    return []

async def _run_doc_scan(client: GitHubClient, branch: str, files: list[GitHubFile], task: TaskConfig, settings: AppSettings, run_id: str) -> list[dict]:
    # Implementation omitted for brevity
    return []

async def _run_actions(task: TaskConfig, settings: AppSettings, run_id: str, findings: list[dict], conn: Any) -> None:
    if not findings and task.actions[0].trigger == "findings": return
    for action in task.actions:
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
