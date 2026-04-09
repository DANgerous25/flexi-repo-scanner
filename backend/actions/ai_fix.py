"""AI-powered fix generation and application."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from backend.config import AppSettings, GitHubConnection, TaskAction, TaskConfig
from backend.llm import router as llm

logger = logging.getLogger(__name__)


async def generate_and_apply(
    task: TaskConfig,
    run_id: str,
    findings: list[dict],
    conn: GitHubConnection,
    action: TaskAction,
    settings: AppSettings,
) -> bool:
    """Generate AI fixes for findings and optionally apply them."""
    if not findings:
        return False

    model = action.model or "auto"

    prompt = _build_fix_prompt(task, findings)

    result = await llm.complete(
        model=model,
        messages=[
            {"role": "system", "content": FIX_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        settings=settings,
        temperature=0.1,
        max_tokens=4096,
    )

    if result.get("error"):
        logger.error("AI fix generation failed: %s", result["error"])
        return False

    fixes = _parse_fix_response(result["content"])
    if not fixes:
        logger.warning("AI fix response contained no parseable fixes")
        return False

    if action.target == "github-pr":
        return await _create_fix_pr(task, run_id, fixes, conn, action)
    elif action.target == "clipboard":
        logger.info("Generated %d fixes for clipboard (not auto-applied)", len(fixes))
        return True
    else:
        return await _save_fix_file(task, run_id, fixes, result["content"])


FIX_SYSTEM_PROMPT = """You are an expert code fixer. Given a list of code findings, generate precise fixes.

For each finding, output a JSON array of fix objects:
[
  {
    "file": "path/to/file",
    "line": 42,
    "severity": "high",
    "finding": "Description of the issue",
    "original_code": "the exact code to be replaced",
    "fixed_code": "the replacement code",
    "explanation": "Why this fix is correct"
  }
]

Rules:
- original_code must be an exact substring of the source file so it can be found and replaced
- fixed_code must be a complete, working replacement
- Preserve indentation and formatting exactly
- If a finding doesn't need a code change (e.g., it's a process issue), omit it from the array
- Output ONLY the JSON array, no other text"""


def _build_fix_prompt(task: TaskConfig, findings: list[dict]) -> str:
    lines = [
        f"Task: {task.name}",
        f"Findings to fix: {len(findings)}",
        "",
    ]

    by_file: dict[str, list[dict]] = {}
    for f in findings:
        fp = f.get("file_path", "unknown")
        by_file.setdefault(fp, []).append(f)

    for filepath, file_findings in sorted(by_file.items()):
        lines.append(f"## File: {filepath}")
        for f in sorted(file_findings, key=lambda x: x.get("line_number", 0)):
            lines.append(f"- Line {f.get('line_number', '?')}: [{f.get('severity', 'medium').upper()}] {f.get('description', '')}")
            if f.get("matched_text"):
                lines.append(f"  Matched: `{f['matched_text']}`")
            if f.get("context"):
                lines.append(f"  Context: `{f['context'][:200]}`")
        lines.append("")

    return "\n".join(lines)


def _parse_fix_response(content: str) -> list[dict]:
    """Parse JSON fix objects from the LLM response."""
    try:
        if "```json" in content:
            start = content.index("```json") + 7
            end = content.index("```", start)
            content = content[start:end].strip()
        elif "```" in content:
            start = content.index("```") + 3
            end = content.index("```", start)
            content = content[start:end].strip()

        data = json.loads(content)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "fixes" in data:
            return data["fixes"]
    except (json.JSONDecodeError, ValueError, Exception):
        pass
    return []


async def _save_fix_file(
    task: TaskConfig,
    run_id: str,
    fixes: list[dict],
    raw_content: str,
) -> bool:
    """Save generated fixes to a file."""
    from pathlib import Path
    from backend.config import DATA_DIR

    fixes_dir = DATA_DIR / "fix-prompts"
    fixes_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"{task.id}_{timestamp}.md"

    lines = [
        f"# AI Fix Suggestions: {task.name}",
        f"Run: {run_id}",
        f"Generated: {timestamp}",
        f"Fixes: {len(fixes)}",
        "",
        "---",
        "",
    ]

    for fix in fixes:
        lines.append(f"## `{fix.get('file', 'unknown')}` — Line {fix.get('line', '?')}")
        lines.append(f"**Severity:** {fix.get('severity', 'medium').upper()}")
        lines.append(f"**Finding:** {fix.get('finding', '')}")
        lines.append(f"**Explanation:** {fix.get('explanation', '')}")
        lines.append("")
        lines.append("**Original:**")
        lines.append("```")
        lines.append(fix.get("original_code", ""))
        lines.append("```")
        lines.append("")
        lines.append("**Fixed:**")
        lines.append("```")
        lines.append(fix.get("fixed_code", ""))
        lines.append("```")
        lines.append("")
        lines.append("---")
        lines.append("")

    path = fixes_dir / filename
    path.write_text("\n".join(lines), encoding="utf-8")
    logger.info("AI fixes saved to %s", path)
    return True


async def _create_fix_pr(
    task: TaskConfig,
    run_id: str,
    fixes: list[dict],
    conn: GitHubConnection,
    action: TaskAction,
) -> bool:
    """Create a GitHub Pull Request with the fixes applied."""
    import httpx

    if not conn.token:
        logger.error("No GitHub token — cannot create fix PR")
        return False

    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {conn.token}",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    branch_name = f"fix/{task.id}-{timestamp}"
    base_branch = conn.default_branch or "main"

    async with httpx.AsyncClient() as client:
        try:
            base_resp = await client.get(
                f"https://api.github.com/repos/{conn.owner}/{conn.repo}/git/ref/heads/{base_branch}",
                headers=headers,
                timeout=15.0,
            )
            base_resp.raise_for_status()
            base_sha = base_resp.json()["object"]["sha"]

            await client.post(
                f"https://api.github.com/repos/{conn.owner}/{conn.repo}/git/refs",
                headers=headers,
                json={"ref": f"refs/heads/{branch_name}", "sha": base_sha},
                timeout=15.0,
            )

            for fix in fixes:
                file_path = fix.get("file", "")
                original = fix.get("original_code", "")
                replacement = fix.get("fixed_code", "")

                if not file_path or not original:
                    continue

                file_resp = await client.get(
                    f"https://api.github.com/repos/{conn.owner}/{conn.repo}/contents/{file_path}",
                    headers=headers,
                    params={"ref": branch_name},
                    timeout=15.0,
                )
                if file_resp.status_code != 200:
                    continue

                import base64
                file_data = file_resp.json()
                content = base64.b64decode(file_data["content"]).decode("utf-8", errors="replace")

                if original not in content:
                    logger.warning("Original code not found in %s — skipping", file_path)
                    continue

                new_content = content.replace(original, replacement, 1)

                await client.put(
                    f"https://api.github.com/repos/{conn.owner}/{conn.repo}/contents/{file_path}",
                    headers=headers,
                    json={
                        "message": f"fix: {fix.get('finding', 'Auto-fix')[:72]}",
                        "content": base64.b64encode(new_content.encode()).decode(),
                        "sha": file_data["sha"],
                        "branch": branch_name,
                    },
                    timeout=15.0,
                )

            pr_body_lines = [
                f"## Auto-fix PR for: {task.name}",
                f"Run ID: {run_id}",
                f"Fixes applied: {len(fixes)}",
                "",
            ]
            for fix in fixes:
                pr_body_lines.append(
                    f"- **{fix.get('file', '?')}** line {fix.get('line', '?')}: "
                    f"{fix.get('finding', '')} ({fix.get('severity', 'medium')})"
                )

            labels = action.labels or ["auto-fix"]
            pr_resp = await client.post(
                f"https://api.github.com/repos/{conn.owner}/{conn.repo}/pulls",
                headers=headers,
                json={
                    "title": f"[Auto-fix] {task.name} — {len(fixes)} fix(es)",
                    "body": "\n".join(pr_body_lines),
                    "head": branch_name,
                    "base": base_branch,
                },
                timeout=15.0,
            )
            pr_resp.raise_for_status()
            pr = pr_resp.json()
            logger.info("Created fix PR #%s for task %s", pr.get("number"), task.id)

            for label in labels:
                try:
                    await client.post(
                        f"https://api.github.com/repos/{conn.owner}/{conn.repo}/issues/{pr['number']}/labels",
                        headers=headers,
                        json={"labels": [label]},
                        timeout=10.0,
                    )
                except Exception:
                    pass

            return True

        except Exception as e:
            logger.error("Failed to create fix PR: %s", e)
            return False
