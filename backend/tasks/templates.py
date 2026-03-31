"""Copy-as-template functionality for tasks."""

from __future__ import annotations

import uuid

from backend.config import TaskConfig


def copy_as_template(source: TaskConfig) -> TaskConfig:
    """Create a template copy of a task.

    - Generates new ID
    - Prefixes name with "Copy of"
    - Clears connection (user must assign)
    - Preserves all rules, actions, config
    """
    data = source.model_dump()

    # New identity
    data["id"] = str(uuid.uuid4())[:8]
    data["name"] = f"Copy of {source.name}"
    data["description"] = source.description

    # Clear connection — user must assign
    data["connection"] = ""

    # Deactivate — user should review before activating
    data["active"] = False

    return TaskConfig(**data)
