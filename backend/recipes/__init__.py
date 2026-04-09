"""Built-in recipe packs — curated, tested rule sets for common scan scenarios."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

import yaml

from backend.config import (
    AllowlistEntry,
    ContextFilter,
    ScanRule,
)

logger = logging.getLogger(__name__)

RECIPES_DIR = Path(__file__).parent

_cache: dict[str, dict] = {}


def _load_recipe_file(path: Path) -> dict:
    """Load a single recipe YAML file. Unwraps the top-level recipe ID key."""
    with open(path) as f:
        raw = yaml.safe_load(f) or {}
    # Recipes are keyed by ID at the top level: {recipe-id: {name, rules, ...}}
    if len(raw) == 1:
        return next(iter(raw.values()))
    return raw


def list_recipes() -> list[dict[str, Any]]:
    """List all available recipe packs with metadata."""
    recipes = []
    for path in sorted(RECIPES_DIR.glob("*.yaml")):
        recipe_id = path.stem
        data = _load_recipe_file(path)
        recipes.append({
            "id": recipe_id,
            "name": data.get("name", recipe_id),
            "description": data.get("description", ""),
            "category": data.get("category", "general"),
            "rule_count": len(data.get("rules", [])),
        })
    return recipes


def get_recipe(recipe_id: str) -> Optional[dict[str, Any]]:
    """Get full recipe data by ID."""
    path = RECIPES_DIR / f"{recipe_id}.yaml"
    if not path.exists():
        return None
    return _load_recipe_file(path)


def resolve_recipes(recipe_ids: list[str]) -> dict[str, Any]:
    """Expand a list of recipe IDs into merged rules, allowlists, and context_filters.

    Returns a dict with:
      - rules: list[ScanRule]
      - allowlist: list[AllowlistEntry]
      - context_filters: list[ContextFilter]
    """
    all_rules: list[ScanRule] = []
    all_allowlist: list[AllowlistEntry] = []
    all_context_filters: list[ContextFilter] = []
    seen_rule_ids: set[str] = set()

    for recipe_id in recipe_ids:
        data = get_recipe(recipe_id)
        if data is None:
            logger.warning("Recipe '%s' not found — skipping", recipe_id)
            continue

        for rule_data in data.get("rules", []):
            rule = ScanRule(**rule_data)
            if rule.id not in seen_rule_ids:
                all_rules.append(rule)
                seen_rule_ids.add(rule.id)

        for entry_data in data.get("default_allowlist", []):
            all_allowlist.append(AllowlistEntry(**entry_data))

        for cf_data in data.get("context_filters", []):
            cf = ContextFilter(**cf_data)
            if not any(existing.type == cf.type for existing in all_context_filters):
                all_context_filters.append(cf)

    return {
        "rules": all_rules,
        "allowlist": all_allowlist,
        "context_filters": all_context_filters,
    }
