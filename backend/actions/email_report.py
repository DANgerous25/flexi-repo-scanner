"""Send scan findings via SMTP email."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from email.message import EmailMessage

import aiosmtplib

from backend.config import AppSettings, TaskConfig

logger = logging.getLogger(__name__)


async def send(
    task: TaskConfig,
    run_id: str,
    findings: list[dict],
    recipients: list[str],
    settings: AppSettings,
) -> bool:
    """Format and send scan findings via email."""
    if not recipients:
        return False
    if not settings.smtp.host:
        logger.warning("SMTP not configured, skipping email")
        return False

    body = _format_report(task, run_id, findings)
    subject = f"[{task.name}] {len(findings)} finding(s) — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{settings.smtp.from_name} <{settings.smtp.from_address}>"
    msg["To"] = ", ".join(recipients)
    msg.set_content(body)

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp.host,
            port=settings.smtp.port,
            username=settings.smtp.username or None,
            password=settings.smtp.password or None,
            use_tls=settings.smtp.tls,
        )
        logger.info(f"Email sent to {recipients} for task {task.id}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False


def _format_report(task: TaskConfig, run_id: str, findings: list[dict]) -> str:
    """Format findings as a plain text report."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        f"Scan Report: {task.name}",
        f"Run ID: {run_id}",
        f"Time: {now}",
        f"Type: {task.scan.type}",
        f"Mode: {task.scan.mode}",
        "=" * 60,
        "",
    ]

    if not findings:
        lines.append("No findings. All clear.")
        return "\n".join(lines)

    lines.append(f"Total findings: {len(findings)}")
    lines.append("")

    # Group by category
    by_category: dict[str, list[dict]] = {}
    for f in findings:
        cat = f.get("category", "Unknown")
        by_category.setdefault(cat, []).append(f)

    for category, cat_findings in sorted(by_category.items()):
        lines.append(f"[{category}] — {len(cat_findings)} finding(s)")
        lines.append("-" * 40)
        for f in cat_findings:
            lines.append(f"  File: {f.get('file_path', 'N/A')}:{f.get('line_number', 0)}")
            lines.append(f"  Severity: {f.get('severity', 'medium')}")
            lines.append(f"  Rule: {f.get('description', '')}")
            if f.get("context"):
                lines.append(f"  Context: {f['context'][:200]}")
            lines.append("")

    lines.append("=" * 60)
    return "\n".join(lines)
