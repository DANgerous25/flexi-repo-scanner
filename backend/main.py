"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.api import benchmarks, connections, notifications, results, runs, settings, tasks
from backend.storage import config_loader, db
from backend.tasks import scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic."""
    logger.info("Starting Flexi Repo Scanner")
    # Initialise encrypted secrets vault
    try:
        from backend.storage.secrets import get_vault
        vault = get_vault()
        vault.export_to_env()
        logger.info("Secrets vault loaded (%d keys)", len(vault.list_keys()))
    except Exception as exc:
        logger.warning("Secrets vault not available: %s", exc)
    # Ensure database is initialised
    await db.get_db()
    # Recover any runs left in 'running' state from a previous crash/restart
    stale_runs = await db.recover_stale_runs()
    if stale_runs:
        for sr in stale_runs:
            await db.upsert_task_state(sr["task_id"], status="failed")
            logger.warning(
                "Recovered stale run %s for task %s — marked as failed (server restart)",
                sr["id"], sr["task_id"],
            )
        logger.info("Recovered %d stale run(s) from previous session", len(stale_runs))
    # Start scheduler
    app_settings = config_loader.load_settings()
    await scheduler.start_scheduler(app_settings)
    logger.info("Scanner ready")
    yield
    # Shutdown
    await scheduler.stop_scheduler()
    await db.close_db()
    logger.info("Scanner stopped")


app = FastAPI(
    title="Flexi Repo Scanner",
    description="Self-hosted, LLM-powered code analysis platform",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow local dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
app.include_router(tasks.router)
app.include_router(runs.router)
app.include_router(connections.router)
app.include_router(results.router)
app.include_router(benchmarks.router)
app.include_router(settings.router)
app.include_router(notifications.router)


# Health check
@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


# Dashboard stats
@app.get("/api/dashboard")
async def dashboard():
    """Get dashboard overview data."""
    all_tasks = config_loader.load_tasks()
    recent = await db.get_recent_runs(20)
    unread = await db.get_unread_count()

    # Build task name lookup
    task_names = {t.id: t.name for t in all_tasks}

    # Enrich recent runs with task names
    for run in recent:
        run["task_name"] = task_names.get(run.get("task_id", ""), run.get("task_id", "Unknown"))

    # Count by state
    active = sum(1 for t in all_tasks if t.active)
    total_findings_today = 0
    failed_tasks = []

    for run in recent:
        if run.get("status") == "failed":
            failed_tasks.append(run.get("task_id", ""))

    task_summaries = []
    for task in all_tasks:
        state = await db.get_task_state(task.id)
        next_run = scheduler.get_next_run(task.id)
        runs = await db.get_task_runs(task.id, 1)
        last_run = runs[0] if runs else None

        task_summaries.append({
            "id": task.id,
            "name": task.name,
            "type": task.scan.type,
            "active": task.active,
            "connection": task.connection,
            "status": state.get("status", "inactive") if state else "inactive",
            "last_run": last_run,
            "next_run_at": next_run,
            "finding_count": last_run.get("finding_count", 0) if last_run else 0,
        })

    return {
        "tasks": task_summaries,
        "recent_runs": recent,
        "stats": {
            "total_tasks": len(all_tasks),
            "active_tasks": active,
            "unread_notifications": unread,
            "failed_tasks": list(set(failed_tasks)),
        },
    }


# Serve frontend static files in production
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    app_settings = config_loader.load_settings()
    uvicorn.run(
        "backend.main:app",
        host=app_settings.server.host,
        port=app_settings.server.port,
        reload=True,
    )
