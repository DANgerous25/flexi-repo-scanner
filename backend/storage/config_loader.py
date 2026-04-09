"""YAML config file loader with ${ENV_VAR} interpolation."""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from typing import Optional

import yaml

from backend.config import (
    CONFIG_DIR,
    AppSettings,
    ConnectionsConfig,
    GitHubConnection,
    TaskConfig,
    _interpolate,
)

logger = logging.getLogger(__name__)

_ENV_RE = re.compile(r"\$\{([^}]+)\}")

_cache: dict[str, tuple[float, dict]] = {}


def _load_yaml(path: Path, interpolate: bool = True) -> dict:
    """Load a YAML file with mtime-based caching. If interpolate=True, replace ${ENV_VAR} references."""
    path_str = str(path)
    if not path.exists():
        _cache.pop(path_str, None)
        return {}

    mtime = path.stat().st_mtime
    cached = _cache.get(path_str)
    if cached and cached[0] == mtime:
        raw = cached[1]
    else:
        with open(path) as f:
            raw = yaml.safe_load(f) or {}
        _cache[path_str] = (mtime, raw)

    if interpolate:
        return _interpolate(raw)
    return raw


def _save_yaml(path: Path, data: dict) -> None:
    """Save dict as YAML and invalidate cache."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
    _cache.pop(str(path), None)


# ── Settings ─────────────────────────────────────────────────────────────

def load_settings() -> AppSettings:
    raw = _load_yaml(CONFIG_DIR / "settings.yaml")
    # The YAML structure is: llm.fallback_order + llm.providers
    # which maps directly to the LlmConfig model — no flattening needed.
    return AppSettings(**raw)


def save_settings(settings: AppSettings) -> None:
    settings_path = CONFIG_DIR / "settings.yaml"
    raw_data = _load_yaml(settings_path, interpolate=False) if settings_path.exists() else {}
    data = settings.model_dump()
    if raw_data:
        data = _deep_merge_preserve_placeholders(raw_data, data)
    _save_yaml(settings_path, data)


# ── Connections ──────────────────────────────────────────────────────────

def load_connections() -> list[GitHubConnection]:
    raw = _load_yaml(CONFIG_DIR / "connections.yaml")
    cfg = ConnectionsConfig(**raw)
    return cfg.connections


def save_connections(connections: list[GitHubConnection]) -> None:
    conn_path = CONFIG_DIR / "connections.yaml"
    raw_data = _load_yaml(conn_path, interpolate=False) if conn_path.exists() else {}
    data = {"connections": [c.model_dump() for c in connections]}
    if raw_data:
        data = _deep_merge_preserve_placeholders(raw_data, data)
    _save_yaml(conn_path, data)


def get_connection(conn_id: str) -> Optional[GitHubConnection]:
    for c in load_connections():
        if c.id == conn_id:
            return c
    return None


# ── Tasks ────────────────────────────────────────────────────────────────

def _tasks_dir() -> Path:
    d = CONFIG_DIR / "tasks"
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_tasks() -> list[TaskConfig]:
    tasks = []
    tasks_dir = _tasks_dir()
    for path in sorted(tasks_dir.glob("*.yaml")):
        raw = _load_yaml(path)
        if raw:
            task = TaskConfig(**raw)
            if not task.id:
                task.id = path.stem
            tasks.append(task)
    return tasks


def load_task(task_id: str) -> Optional[TaskConfig]:
    path = _tasks_dir() / f"{task_id}.yaml"
    if not path.exists():
        # Search by id field in all files
        for task in load_tasks():
            if task.id == task_id:
                return task
        return None
    raw = _load_yaml(path)
    if not raw:
        return None
    task = TaskConfig(**raw)
    if not task.id:
        task.id = path.stem
    return task


def _validate_id(item_id: str) -> None:
    """Validate an ID is safe for use as a filename (prevent path traversal)."""
    if not item_id:
        return
    if "/" in item_id or "\\" in item_id or ".." in item_id:
        raise ValueError(f"Invalid ID '{item_id}': contains path traversal characters")
    if not re.match(r"^[a-zA-Z0-9_\-]+$", item_id):
        raise ValueError(f"Invalid ID '{item_id}': must contain only alphanumeric chars, hyphens, and underscores")


def save_task(task: TaskConfig) -> None:
    if not task.id:
        task.id = str(uuid.uuid4())[:8]
    _validate_id(task.id)
    path = _tasks_dir() / f"{task.id}.yaml"
    # Load the raw (uninterpolated) YAML to preserve ${VAR} placeholders
    raw_data = _load_yaml(path, interpolate=False) if path.exists() else {}
    # If the file has raw data with ${...} placeholders, use it as the base
    # and merge the task's fields on top, preserving placeholders
    if raw_data:
        updated = _deep_merge_preserve_placeholders(raw_data, task.model_dump())
        _save_yaml(path, updated)
    else:
        # New task — save model_dump but warn about potential secret leakage
        _save_yaml(path, task.model_dump())


def _deep_merge_preserve_placeholders(raw: dict, resolved: dict) -> dict:
    """Merge resolved values back into raw data, preserving ${VAR} placeholders
    in raw where the resolved value came from interpolation."""
    result = dict(raw)
    for key, value in resolved.items():
        if key not in result:
            result[key] = value
        elif isinstance(value, dict) and isinstance(result[key], dict):
            result[key] = _deep_merge_preserve_placeholders(result[key], value)
        elif isinstance(value, list) and isinstance(result[key], list):
            # For lists, prefer the raw (uninterpolated) version to keep placeholders
            result[key] = raw[key]
        elif isinstance(result[key], str) and _ENV_RE.search(result[key]):
            # Keep the raw placeholder version
            pass
        else:
            # Use the resolved value for non-placeholder fields
            result[key] = value
    return result


def delete_task(task_id: str) -> bool:
    _validate_id(task_id)
    path = _tasks_dir() / f"{task_id}.yaml"
    if path.exists():
        path.unlink()
        return True
    return False
