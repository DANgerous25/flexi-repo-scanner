"""APScheduler integration for cron-based task scheduling."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from backend.config import AppSettings, TaskConfig
from backend.storage import config_loader, db
from backend.tasks.executor import run_task

logger = logging.getLogger(__name__)

_scheduler: Optional[AsyncIOScheduler] = None
_scheduler_lock = asyncio.Lock()


async def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    async with _scheduler_lock:
        if _scheduler is None:
            _scheduler = AsyncIOScheduler()
    return _scheduler


async def start_scheduler(settings: AppSettings) -> None:
    """Start the scheduler and load all active tasks."""
    scheduler = await get_scheduler()
    if scheduler.running:
        return

    scheduler.start()
    logger.info("Scheduler started")

    # Schedule periodic cleanup job (daily at 3am UTC)
    scheduler.add_job(
        _run_cleanup,
        trigger=CronTrigger(hour=3, minute=0, timezone="UTC"),
        id="cleanup_old_data",
        replace_existing=True,
        misfire_grace_time=600,
    )

    # Load and schedule all active tasks
    await sync_tasks(settings)


async def stop_scheduler() -> None:
    scheduler = await get_scheduler()
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


async def sync_tasks(settings: AppSettings) -> None:
    """Sync task schedules with config files."""
    scheduler = await get_scheduler()
    tasks = config_loader.load_tasks()

    # Get current job IDs
    current_jobs = {job.id for job in scheduler.get_jobs()}
    expected_jobs = set()

    for task in tasks:
        job_id = f"task_{task.id}"
        expected_jobs.add(job_id)

        if task.active and task.schedule.cron:
            if job_id in current_jobs:
                scheduler.reschedule_job(
                    job_id,
                    trigger=_make_trigger(task),
                )
            else:
                scheduler.add_job(
                    _execute_task,
                    trigger=_make_trigger(task),
                    id=job_id,
                    args=[task.id],
                    replace_existing=True,
                    misfire_grace_time=300,
                )
            job = scheduler.get_job(job_id)
            next_run = job.next_run_time.isoformat() if job and job.next_run_time else None
            await db.upsert_task_state(task.id, status="scheduled", next_run_at=next_run)
            logger.info("Scheduled task %s: %s (%s)", task.id, task.schedule.cron, task.schedule.timezone)
        else:
            if job_id in current_jobs:
                scheduler.remove_job(job_id)
            await db.upsert_task_state(task.id, status="inactive")

    # Remove orphaned jobs
    for job_id in current_jobs - expected_jobs:
        if job_id.startswith("task_"):
            scheduler.remove_job(job_id)


async def schedule_task(task: TaskConfig) -> None:
    """Schedule or update a single task."""
    scheduler = await get_scheduler()
    job_id = f"task_{task.id}"

    if task.active and task.schedule.cron:
        scheduler.add_job(
            _execute_task,
            trigger=_make_trigger(task),
            id=job_id,
            args=[task.id],
            replace_existing=True,
            misfire_grace_time=300,
        )
        job = scheduler.get_job(job_id)
        next_run = job.next_run_time.isoformat() if job and job.next_run_time else None
        await db.upsert_task_state(task.id, status="scheduled", next_run_at=next_run)
    else:
        try:
            scheduler.remove_job(job_id)
        except Exception:
            pass
        await db.upsert_task_state(task.id, status="inactive")


async def unschedule_task(task_id: str) -> None:
    """Remove a task from the scheduler."""
    scheduler = await get_scheduler()
    job_id = f"task_{task_id}"
    try:
        scheduler.remove_job(job_id)
    except Exception:
        pass


def get_next_run(task_id: str) -> Optional[str]:
    """Get the next run time for a task. Sync — only call after scheduler is started."""
    if _scheduler is None:
        return None
    job = _scheduler.get_job(f"task_{task_id}")
    if job and job.next_run_time:
        return job.next_run_time.isoformat()
    return None


def _make_trigger(task: TaskConfig) -> CronTrigger:
    """Create a cron trigger from task config."""
    return CronTrigger.from_crontab(
        task.schedule.cron,
        timezone=task.schedule.timezone or "UTC",
    )


async def _execute_task(task_id: str) -> None:
    """Callback for scheduled task execution."""
    logger.info("Scheduled execution of task %s", task_id)
    try:
        settings = config_loader.load_settings()
        task = config_loader.load_task(task_id)
        if task is None:
            logger.error("Task %s not found in config", task_id)
            return
        if not task.active:
            logger.info("Task %s is inactive, skipping", task_id)
            return
        await run_task(task, settings)
    except Exception as e:
        logger.error("Scheduled task %s failed: %s", task_id, e)


async def _run_cleanup() -> None:
    """Periodic cleanup of old scan data based on retention settings."""
    try:
        settings = config_loader.load_settings()
        retention_days = settings.retention.max_days or settings.retention.results_days
        if retention_days > 0:
            deleted = await db.cleanup_old_data(retention_days)
            if deleted:
                logger.info("Cleanup: removed %d old findings (retention: %d days)", deleted, retention_days)
    except Exception as e:
        logger.error("Scheduled cleanup failed: %s", e)
