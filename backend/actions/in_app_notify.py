"""Create in-app dashboard notifications."""

from __future__ import annotations

import logging

from backend.config import TaskConfig
from backend.storage import db

logger = logging.getLogger(__name__)


async def notify(
    task: TaskConfig,
    run_id: str,
    findings: list[dict],
) -> None:
    """Create an in-app notification for scan results."""
    count = len(findings)

    if count == 0:
        title = f"{task.name}: Clean scan"
        message = "No findings detected."
    else:
        # Count by severity
        severity_counts: dict[str, int] = {}
        for f in findings:
            sev = f.get("severity", "medium")
            severity_counts[sev] = severity_counts.get(sev, 0) + 1

        parts = []
        for sev in ["critical", "high", "medium", "low", "info"]:
            if sev in severity_counts:
                parts.append(f"{severity_counts[sev]} {sev}")

        title = f"{task.name}: {count} finding(s)"
        message = f"Found {', '.join(parts)}."

    await db.create_notification(task.id, run_id, title, message)
    logger.info(f"Notification created for task {task.id}: {title}")
