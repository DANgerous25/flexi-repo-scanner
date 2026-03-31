"""Task management API routes."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Optional

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import TaskConfig
from backend.llm import router as llm
from backend.storage import config_loader, db
from backend.tasks import executor, scheduler, templates

logger = logging.getLogger(__name__)

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


class GenerateRequest(BaseModel):
    mode: str  # "create" | "refine"
    prompt: str
    current_config: Optional[dict] = None


CREATE_SYSTEM_PROMPT = """\
You are a code scanning rule generator. The user will describe what they want to scan for in their code repository.

Generate YAML configuration for a pattern-based code scanner. Output ONLY valid YAML with no other text.

Format:
rules:
  - id: "rule-id"
    name: "Human Readable Name"
    pattern: 'regex-pattern-here'
    severity: "critical|high|medium|low|info"
    case_sensitive: true|false
    context_requires: 'optional-context-regex'

Guidelines:
- Use precise regex patterns that minimize false positives
- Set appropriate severity levels
- Add context_requires when a pattern alone would have too many false positives
- Group related patterns into separate rules with descriptive IDs
- Use case_sensitive: false for text that could appear in any case"""

REFINE_SYSTEM_PROMPT = """\
You are a code scanning rule refinement assistant. The user has an existing scanner task config and wants to modify it.

Review the current config and the user's refinement request. Suggest specific changes.

Output ONLY valid YAML blocks showing the changes. Use these sections:

rules_to_add:
  - id: "new-rule"
    name: "..."
    pattern: '...'
    severity: "..."

rules_to_modify:
  - id: "existing-rule-id"
    changes:
      pattern: 'new-pattern'

rules_to_remove:
  - "rule-id-to-remove"

allowlist_to_add:
  - file: "path/glob"
    match: "exact-match-text"
    rules: ["rule-id"]
    reason: "Why this is allowlisted"

paths_to_exclude:
  - "new/path/to/exclude/"

Explain each change briefly in a YAML comment. Only include sections that have changes."""


def _strip_yaml_fences(text: str) -> str:
    """Remove markdown code fences from LLM output so yaml.safe_load works."""
    text = text.strip()
    text = re.sub(r"^```(?:ya?ml)?\s*\n", "", text)
    text = re.sub(r"\n```\s*$", "", text)
    return text.strip()


def _parse_suggestions(raw: str, mode: str) -> dict[str, Any]:
    """Parse the raw YAML suggestions from the LLM into structured JSON."""
    cleaned = _strip_yaml_fences(raw)
    try:
        data = yaml.safe_load(cleaned) or {}
    except yaml.YAMLError as exc:
        logger.warning("Failed to parse YAML suggestions: %s", exc)
        return {}

    if not isinstance(data, dict):
        return {}

    if mode == "create":
        rules = data.get("rules", [])
        if isinstance(rules, list):
            return {"rules": rules}
        return {}

    # refine mode
    return {
        "rules_to_add": data.get("rules_to_add", []),
        "rules_to_modify": data.get("rules_to_modify", []),
        "rules_to_remove": data.get("rules_to_remove", []),
        "allowlist_to_add": data.get("allowlist_to_add", []),
        "paths_to_exclude": data.get("paths_to_exclude", []),
    }


@router.post("/generate")
async def generate_rules(req: GenerateRequest):
    """Call the LLM to generate or refine scanning rules."""
    settings = config_loader.load_settings()

    if req.mode == "create":
        system = CREATE_SYSTEM_PROMPT
        user_msg = req.prompt
    else:
        system = REFINE_SYSTEM_PROMPT
        user_msg = f"## Current Config\n```yaml\n{yaml.dump(req.current_config)}\n```\n\n## Refinement Request\n{req.prompt}"

    result = await llm.complete(
        model="auto",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user_msg},
        ],
        settings=settings,
        temperature=0.1,
        max_tokens=4096,
    )

    if result.get("error"):
        raise HTTPException(502, f"LLM error: {result['error']}")

    raw_content = result["content"]
    parsed = _parse_suggestions(raw_content, req.mode)

    return {
        "suggestions": raw_content,
        "parsed": parsed,
        "model": result["model"],
        "tokens": {
            "input": result["input_tokens"],
            "output": result["output_tokens"],
        },
    }


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
