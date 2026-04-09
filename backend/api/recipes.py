"""Recipe pack API routes."""

from __future__ import annotations

from fastapi import APIRouter

from backend.recipes import get_recipe, list_recipes

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


@router.get("")
async def get_recipes():
    """List all available recipe packs."""
    return list_recipes()


@router.get("/{recipe_id}")
async def get_recipe_detail(recipe_id: str):
    """Get full details of a recipe pack including all rules."""
    recipe = get_recipe(recipe_id)
    if not recipe:
        from fastapi import HTTPException
        raise HTTPException(404, f"Recipe '{recipe_id}' not found")
    return recipe
