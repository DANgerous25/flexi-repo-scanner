"""Task management API routes."""

from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import TaskConfig
from backend.storage import config_loader, db
from backend.tasks import executor, scheduler, templates

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


class TaskCreateRequest(BaseModel):
    config: dict


class TaskToggleRequest(BaseModel):
    active: bool


class AllowlistEntryRequest(BaseModel):
    file: str = ""
    pattern: str = ""
    match: str = ""
    rules: list[str] = []
    reason: str = ""


class AllowlistRequest(BaseModel):
    entries: list[AllowlistEntryRequest]


@router.get("")
async def list_tasks():
    """List all tasks with their current states."""
    tasks = config_loader.load_tasks()
    result = []
    for task in tasks:
        state = await db.get_task_state(task.id)
        next_run = scheduler.get_next_run(task.id)
        result.append({
            **task.model_dump(),
            "state": state or {"status": "inactive"},
            "next_run_at": next_run,
        })
    return result


@router.get("/{task_id}")
async def get_task(task_id: str):
    """Get a single task by ID."""
    task = config_loader.load_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    state = await db.get_task_state(task_id)
    next_run = scheduler.get_next_run(task_id)
    return {
        **task.model_dump(),
        "state": state or {"status": "inactive"},
        "next_run_at": next_run,
    }


@router.post("")
async def create_task(req: TaskCreateRequest):
    """Create a new task from config dict."""
    task = TaskConfig(**req.config)
    config_loader.save_task(task)
    settings = config_loader.load_settings()
    await scheduler.schedule_task(task)
    return {"id": task.id, "message": "Task created"}


@router.put("/{task_id}")
async def update_task(task_id: str, req: TaskCreateRequest):
    """Update an existing task."""
    existing = config_loader.load_task(task_id)
    if not existing:
        raise HTTPException(404, "Task not found")

    task = TaskConfig(**{**req.config, "id": task_id})
    config_loader.save_task(task)
    settings = config_loader.load_settings()
    await scheduler.schedule_task(task)
    return {"id": task_id, "message": "Task updated"}


@router.delete("/{task_id}")
async def delete_task(task_id: str):
    """Delete a task."""
    if not config_loader.delete_task(task_id):
        raise HTTPException(404, "Task not found")
    await scheduler.unschedule_task(task_id)
    return {"message": "Task deleted"}


@router.post("/{task_id}/toggle")
async def toggle_task(task_id: str, req: TaskToggleRequest):
    """Activate or deactivate a task."""
    task = config_loader.load_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    task.active = req.active
    config_loader.save_task(task)
    await scheduler.schedule_task(task)
    return {"id": task_id, "active": task.active}


@router.post("/{task_id}/run")
async def run_task_now(task_id: str):
    """Trigger an immediate run of a task."""
    task = config_loader.load_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    settings = config_loader.load_settings()

    # Run in background
    async def _run():
        try:
            await executor.run_task(task, settings)
        except Exception:
            pass

    asyncio.create_task(_run())
    return {"message": f"Task {task_id} triggered", "task_id": task_id}


@router.post("/{task_id}/copy")
async def copy_task(task_id: str):
    """Copy a task as a new template."""
    task = config_loader.load_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    new_task = templates.copy_as_template(task)
    config_loader.save_task(new_task)
    return {"id": new_task.id, "name": new_task.name, "message": "Task copied"}


@router.post("/{task_id}/allowlist")
async def add_allowlist_entries(task_id: str, req: AllowlistRequest):
    """Append entries to a task's scan allowlist."""
    task = config_loader.load_task(task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    from backend.config import AllowlistEntry

    for entry in req.entries:
        task.scan.allowlist.append(AllowlistEntry(
            file=entry.file,
            pattern=entry.pattern,
            match=entry.match,
            rules=entry.rules,
            reason=entry.reason,
        ))

    config_loader.save_task(task)
    return {"allowlist": [e.model_dump() for e in task.scan.allowlist]}


@router.get("/{task_id}/results")
async def get_task_results(task_id: str, limit: int = 50):
    """Get run history for a task."""
    runs = await db.get_task_runs(task_id, limit)
    return runs
