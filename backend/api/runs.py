"""Run management API routes — cancel, stop, and status operations."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from backend.storage import db
from backend.tasks.executor import _running_runs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/runs", tags=["runs"])

RUN_TIMEOUT_MINUTES = 30


@router.post("/{run_id}/cancel")
async def cancel_run(run_id: str):
    """Cancel a running scan. Sets status to 'cancelled'."""
    run = await db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    if run["status"] not in ("running",):
        raise HTTPException(
            409, f"Run is already '{run['status']}' — can only cancel running runs"
        )

    updated = await db.cancel_run(run_id, reason="Cancelled by user")
    # Also update the task state so the dashboard reflects the change
    await db.upsert_task_state(run["task_id"], status="failed")

    # Cancel the asyncio task if it's still running
    atask = _running_runs.get(run_id)
    if atask and not atask.done():
        atask.cancel()
        logger.info("Run %s cancelled by user (asyncio task cancelled)", run_id)
    else:
        logger.info("Run %s cancelled by user", run_id)
    return updated


@router.post("/{run_id}/stop")
async def stop_run(run_id: str):
    """Stop a running scan. Alias for cancel that marks as 'failed'."""
    run = await db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    if run["status"] not in ("running",):
        raise HTTPException(
            409, f"Run is already '{run['status']}' — can only stop running runs"
        )

    await db.fail_run(run_id, "Manually stopped by user")
    await db.upsert_task_state(run["task_id"], status="failed")

    # Cancel the asyncio task if it's still running
    atask = _running_runs.get(run_id)
    if atask and not atask.done():
        atask.cancel()
        logger.info("Run %s manually stopped by user (asyncio task cancelled)", run_id)
    else:
        logger.info("Run %s manually stopped by user", run_id)
    return await db.get_run(run_id)
