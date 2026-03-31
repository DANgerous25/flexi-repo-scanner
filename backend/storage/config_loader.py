"""YAML config file loader with ${ENV_VAR} interpolation."""

from __future__ import annotations

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


def _load_yaml(path: Path) -> dict:
    """Load a YAML file and interpolate env vars."""
    if not path.exists():
        return {}
    with open(path) as f:
        raw = yaml.safe_load(f) or {}
    return _interpolate(raw)


def _save_yaml(path: Path, data: dict) -> None:
    """Save dict as YAML."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        yaml.dump(data, f, default_flow_style=False, sort_keys=False, allow_unicode=True)


# ── Settings ─────────────────────────────────────────────────────────────

def load_settings() -> AppSettings:
    raw = _load_yaml(CONFIG_DIR / "settings.yaml")
    # Flatten llm.providers to just llm dict
    if "llm" in raw and "providers" in raw["llm"]:
        raw["llm"] = raw["llm"]["providers"]
    return AppSettings(**raw)


def save_settings(settings: AppSettings) -> None:
    data = settings.model_dump()
    # Re-nest llm providers
    llm_data = data.pop("llm", {})
    data["llm"] = {"providers": llm_data}
    _save_yaml(CONFIG_DIR / "settings.yaml", data)


# ── Connections ──────────────────────────────────────────────────────────

def load_connections() -> list[GitHubConnection]:
    raw = _load_yaml(CONFIG_DIR / "connections.yaml")
    cfg = ConnectionsConfig(**raw)
    return cfg.connections


def save_connections(connections: list[GitHubConnection]) -> None:
    data = {"connections": [c.model_dump() for c in connections]}
    _save_yaml(CONFIG_DIR / "connections.yaml", data)


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


def save_task(task: TaskConfig) -> None:
    if not task.id:
        task.id = str(uuid.uuid4())[:8]
    path = _tasks_dir() / f"{task.id}.yaml"
    _save_yaml(path, task.model_dump())


def delete_task(task_id: str) -> bool:
    path = _tasks_dir() / f"{task_id}.yaml"
    if path.exists():
        path.unlink()
        return True
    return False
