"""Generate fix prompts for external tools (Claude Code, Cursor, etc.)."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from backend.config import DATA_DIR, TaskConfig

logger = logging.getLogger(__name__)

PROMPTS_DIR = DATA_DIR / "fix-prompts"


async def generate(
    task: TaskConfig,
    run_id: str,
    findings: list[dict],
) -> str:
    """Generate a fix prompt from scan findings.

    Returns path to the generated prompt file.
    """
    if not findings:
        return ""

    prompt = _build_fix_prompt(task, findings)

    # Save to file
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"{task.id}_{timestamp}.md"
    path = PROMPTS_DIR / filename

    path.write_text(prompt, encoding="utf-8")
    logger.info(f"Fix prompt saved to {path}")

    return str(path)


def _build_fix_prompt(task: TaskConfig, findings: list[dict]) -> str:
    """Build a detailed fix prompt suitable for Claude Code or similar."""
    lines = [
        f"# Fix Instructions: {task.name}",
        "",
        f"The following {len(findings)} issue(s) were found by an automated scan.",
        "Please fix each one as described below.",
        "",
        "---",
        "",
    ]

    # Group by file
    by_file: dict[str, list[dict]] = {}
    for f in findings:
        fp = f.get("file_path", "unknown")
        by_file.setdefault(fp, []).append(f)

    for filepath, file_findings in sorted(by_file.items()):
        lines.append(f"## `{filepath}`")
        lines.append("")

        for f in sorted(file_findings, key=lambda x: x.get("line_number", 0)):
            severity = f.get("severity", "medium")
            line_num = f.get("line_number", 0)
            desc = f.get("description", "")
            context = f.get("context", "")
            matched = f.get("matched_text", "")

            lines.append(f"### Line {line_num} — {severity.upper()}: {desc}")
            lines.append("")

            if context:
                lines.append("**Current code:**")
                lines.append(f"```")
                lines.append(context)
                lines.append(f"```")
                lines.append("")

            if matched:
                lines.append(f"**Matched text:** `{matched}`")
                lines.append("")

            # Generate specific fix suggestion based on category
            suggestion = _suggest_fix(f)
            if suggestion:
                lines.append(f"**Fix:** {suggestion}")
                lines.append("")

            lines.append("---")
            lines.append("")

    lines.append("")
    lines.append("## Summary")
    lines.append("")

    # Count by severity
    severity_counts: dict[str, int] = {}
    for f in findings:
        sev = f.get("severity", "medium")
        severity_counts[sev] = severity_counts.get(sev, 0) + 1

    for sev in ["critical", "high", "medium", "low", "info"]:
        if sev in severity_counts:
            lines.append(f"- **{sev.capitalize()}**: {severity_counts[sev]}")

    lines.append("")
    lines.append(f"Total files affected: {len(by_file)}")
    lines.append(f"Total issues: {len(findings)}")

    return "\n".join(lines)


def _suggest_fix(finding: dict) -> str:
    """Generate a specific fix suggestion based on finding category."""
    category = finding.get("category", "").lower()
    matched = finding.get("matched_text", "")

    if "email" in category:
        return "Replace the email address with a generic placeholder like `user@example.com` or use an environment variable."

    if "api key" in category or "secret" in category or "credential" in category:
        return "Move this value to an environment variable. Replace the hardcoded value with `os.environ.get('KEY_NAME')` or equivalent."

    if "private key" in category:
        return "Remove the private key from the repository. Store it externally and reference via file path or environment variable."

    if "ai" in category and ("author" in category or "attribution" in category):
        return f"Remove or rephrase this reference. Replace `{matched}` with a neutral alternative that doesn't attribute to AI tools."

    if "employer" in category or "employment" in category:
        return "Remove this reference to avoid exposing employment information in the repository."

    if "phone" in category:
        return "Replace with a placeholder like `+1-555-0100` or remove entirely."

    if "location" in category or "pii" in category:
        return "Remove or generalise this reference to avoid exposing personal information."

    if "documentation" in category:
        return "Add documentation (docstring/JSDoc) for this public symbol."

    if "security" in category or "vulnerability" in category:
        return "Review and fix the security issue as described. Validate inputs, use parameterised queries, and avoid eval()."

    return "Review and fix this finding."
