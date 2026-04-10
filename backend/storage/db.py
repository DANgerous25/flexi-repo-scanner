"""SQLite database for scan results, notifications, and benchmarks."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import aiosqlite

from backend.config import DATA_DIR

logger = logging.getLogger(__name__)

DB_PATH = DATA_DIR / "scanner.db"

_db: Optional[aiosqlite.Connection] = None
_db_lock = asyncio.Lock()
_db_initialized = False

VALID_RUN_COLUMNS = frozenset({
    "status", "completed_at", "total_files", "scanned_files",
    "finding_count", "error_message", "scan_mode", "last_commit_sha",
})

VALID_TASK_STATE_COLUMNS = frozenset({
    "status", "last_run_id", "last_commit_sha", "next_run_at",
})

VALID_FINDING_STATUS_VALUES = frozenset({
    "open", "dismissed", "fix_pending", "fix_applied", "fix_verified",
})


async def get_db() -> aiosqlite.Connection:
    global _db, _db_initialized
    if _db is not None and _db_initialized:
        return _db
    async with _db_lock:
        if _db is not None and _db_initialized:
            return _db
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _db = await aiosqlite.connect(str(DB_PATH))
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL")
        await _db.execute("PRAGMA foreign_keys=ON")
        await _init_schema(_db)
        await _migrate(_db)
        _db_initialized = True
    return _db


async def close_db() -> None:
    global _db, _db_initialized
    if _db:
        await _db.close()
    _db = None
    _db_initialized = False


async def _init_schema(db: aiosqlite.Connection) -> None:
    await db.executescript("""
        CREATE TABLE IF NOT EXISTS scan_runs (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            started_at TEXT NOT NULL,
            completed_at TEXT,
            total_files INTEGER DEFAULT 0,
            scanned_files INTEGER DEFAULT 0,
            finding_count INTEGER DEFAULT 0,
            error_message TEXT,
            scan_mode TEXT,
            last_commit_sha TEXT
        );

        CREATE TABLE IF NOT EXISTS findings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            category TEXT NOT NULL,
            file_path TEXT NOT NULL,
            line_number INTEGER DEFAULT 0,
            severity TEXT NOT NULL DEFAULT 'medium',
            rule_id TEXT,
            description TEXT NOT NULL,
            matched_text TEXT,
            context TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            dismissed_reason TEXT,
            dismissed_at TEXT,
            dismissed_by TEXT,
            fix_requested_at TEXT,
            fix_applied_at TEXT,
            fix_verified_at TEXT,
            first_seen_at TEXT,
            FOREIGN KEY (run_id) REFERENCES scan_runs(id)
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT,
            run_id TEXT,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            read INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS benchmark_runs (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            models TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running'
        );

        CREATE TABLE IF NOT EXISTS benchmark_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            benchmark_id TEXT NOT NULL,
            model_id TEXT NOT NULL,
            finding_count INTEGER DEFAULT 0,
            time_taken_seconds REAL DEFAULT 0,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            estimated_cost REAL DEFAULT 0,
            findings_json TEXT,
            FOREIGN KEY (benchmark_id) REFERENCES benchmark_runs(id)
        );

        CREATE TABLE IF NOT EXISTS task_states (
            task_id TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'inactive',
            last_run_id TEXT,
            last_commit_sha TEXT,
            next_run_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id);
        CREATE INDEX IF NOT EXISTS idx_findings_task ON findings(task_id);
        CREATE INDEX IF NOT EXISTS idx_runs_task ON scan_runs(task_id);
        CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
    """)
    await db.commit()


async def _migrate(db: aiosqlite.Connection) -> None:
    """Run schema migrations for existing databases."""
    try:
        async with db.execute("PRAGMA table_info(findings)") as cursor:
            rows = await cursor.fetchall()
        columns = {row[1] for row in rows}
        if "status" not in columns:
            await db.executescript("""
                ALTER TABLE findings ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
                ALTER TABLE findings ADD COLUMN dismissed_reason TEXT;
                ALTER TABLE findings ADD COLUMN dismissed_at TEXT;
                ALTER TABLE findings ADD COLUMN dismissed_by TEXT;
                ALTER TABLE findings ADD COLUMN fix_requested_at TEXT;
                ALTER TABLE findings ADD COLUMN fix_applied_at TEXT;
                ALTER TABLE findings ADD COLUMN fix_verified_at TEXT;
                ALTER TABLE findings ADD COLUMN first_seen_at TEXT;
            """)
            await db.commit()
            logger.info("Migrated findings table: added status columns")
    except Exception as e:
        logger.warning("Migration check failed (may be fresh DB): %s", e)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


async def _fetchall(db: aiosqlite.Connection, sql: str, params: Any = ()) -> list[dict]:
    """Execute a SELECT and return all rows as dicts, with cursor properly closed."""
    async with db.execute(sql, params) as cursor:
        rows = await cursor.fetchall()
    return [dict(r) for r in rows]


async def _fetchone(db: aiosqlite.Connection, sql: str, params: Any = ()) -> Optional[dict]:
    """Execute a SELECT and return one row as dict, with cursor properly closed."""
    async with db.execute(sql, params) as cursor:
        row = await cursor.fetchone()
    return dict(row) if row else None


# ── Scan Runs ────────────────────────────────────────────────────────────

async def create_run(task_id: str, scan_mode: str = "full") -> str:
    db = await get_db()
    run_id = _new_id()
    await db.execute(
        "INSERT INTO scan_runs (id, task_id, status, started_at, scan_mode) VALUES (?, ?, 'running', ?, ?)",
        (run_id, task_id, _now(), scan_mode),
    )
    await db.commit()
    return run_id


async def update_run(run_id: str, **kwargs: Any) -> None:
    invalid = set(kwargs.keys()) - VALID_RUN_COLUMNS
    if invalid:
        raise ValueError(f"Invalid column(s) for scan_runs: {invalid}")
    db = await get_db()
    sets = ", ".join(f"{k} = ?" for k in kwargs)
    vals = list(kwargs.values())
    vals.append(run_id)
    async with db.execute(f"UPDATE scan_runs SET {sets} WHERE id = ?", vals):
        pass
    await db.commit()


async def complete_run(run_id: str, finding_count: int, total_files: int, scanned_files: int,
                       last_commit_sha: str = "") -> None:
    await update_run(
        run_id,
        status="completed",
        completed_at=_now(),
        finding_count=finding_count,
        total_files=total_files,
        scanned_files=scanned_files,
        last_commit_sha=last_commit_sha,
    )


async def fail_run(run_id: str, error_message: str) -> None:
    await update_run(run_id, status="failed", completed_at=_now(), error_message=error_message)


async def cancel_run(run_id: str, reason: str = "Cancelled by user") -> Optional[dict]:
    """Mark a run as cancelled. Returns the updated run or None if not found."""
    run = await get_run(run_id)
    if not run:
        return None
    await update_run(run_id, status="cancelled", completed_at=_now(), error_message=reason)
    return await get_run(run_id)


async def recover_stale_runs() -> list[dict]:
    """Find all runs stuck in 'running' status and mark them as failed.
    Returns the list of recovered runs."""
    db = await get_db()
    stale = await _fetchall(db, "SELECT * FROM scan_runs WHERE status = 'running'")
    now = _now()
    for run in stale:
        await db.execute(
            "UPDATE scan_runs SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?",
            (now, "Server restarted while task was running", run["id"]),
        )
    if stale:
        await db.commit()
    return stale


RUN_TIMEOUT_MINUTES = 30


async def _check_run_timeout(run: dict) -> dict:
    """If a run is 'running' but started more than RUN_TIMEOUT_MINUTES ago, mark it failed."""
    if run["status"] != "running":
        return run
    started = datetime.fromisoformat(run["started_at"])
    elapsed = (datetime.now(timezone.utc) - started).total_seconds() / 60
    if elapsed > RUN_TIMEOUT_MINUTES:
        reason = f"Run timed out after {int(elapsed)} minutes"
        await update_run(run["id"], status="failed", completed_at=_now(), error_message=reason)
        run = {**run, "status": "failed", "completed_at": _now(), "error_message": reason}
    return run


async def get_run(run_id: str) -> Optional[dict]:
    db = await get_db()
    run = await _fetchone(db, "SELECT * FROM scan_runs WHERE id = ?", (run_id,))
    if not run:
        return None
    return await _check_run_timeout(run)


async def get_task_runs(task_id: str, limit: int = 50) -> list[dict]:
    db = await get_db()
    rows = await _fetchall(
        db,
        "SELECT * FROM scan_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?",
        (task_id, limit),
    )
    return [await _check_run_timeout(r) for r in rows]


async def get_run_status(run_id: str) -> Optional[str]:
    """Lightweight single-column query returning just the run status string."""
    db = await get_db()
    row = await _fetchone(db, "SELECT status FROM scan_runs WHERE id = ?", (run_id,))
    return row["status"] if row else None


async def get_recent_runs(limit: int = 20) -> list[dict]:
    db = await get_db()
    rows = await _fetchall(db, "SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT ?", (limit,))
    return [await _check_run_timeout(r) for r in rows]


# ── Findings ─────────────────────────────────────────────────────────────

async def insert_findings(findings: list[dict]) -> None:
    if not findings:
        return
    db = await get_db()
    await db.executemany(
        """INSERT INTO findings (run_id, task_id, category, file_path, line_number,
           severity, rule_id, description, matched_text, context)
           VALUES (:run_id, :task_id, :category, :file_path, :line_number,
           :severity, :rule_id, :description, :matched_text, :context)""",
        findings,
    )
    await db.commit()


async def get_run_findings(run_id: str) -> list[dict]:
    db = await get_db()
    return await _fetchall(
        db,
        "SELECT * FROM findings WHERE run_id = ? ORDER BY severity, file_path, line_number",
        (run_id,),
    )


async def get_findings_summary(run_id: str) -> dict:
    db = await get_db()
    rows = await _fetchall(
        db,
        "SELECT category, severity, COUNT(*) as count FROM findings WHERE run_id = ? GROUP BY category, severity",
        (run_id,),
    )
    return {f"{r['category']}:{r['severity']}": r["count"] for r in rows}


# ── Notifications ────────────────────────────────────────────────────────

async def create_notification(task_id: str, run_id: str, title: str, message: str) -> int:
    db = await get_db()
    cursor = await db.execute(
        "INSERT INTO notifications (task_id, run_id, title, message, created_at) VALUES (?, ?, ?, ?, ?)",
        (task_id, run_id, title, message, _now()),
    )
    await db.commit()
    return cursor.lastrowid


async def get_notifications(limit: int = 50, unread_only: bool = False) -> list[dict]:
    db = await get_db()
    if unread_only:
        return await _fetchall(
            db,
            "SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
    return await _fetchall(
        db,
        "SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?",
        (limit,),
    )


async def get_unread_count() -> int:
    db = await get_db()
    row = await _fetchone(db, "SELECT COUNT(*) as c FROM notifications WHERE read = 0")
    return row["c"] if row else 0


async def mark_notification_read(notification_id: int) -> None:
    db = await get_db()
    await db.execute("UPDATE notifications SET read = 1 WHERE id = ?", (notification_id,))
    await db.commit()


async def mark_all_read() -> None:
    db = await get_db()
    await db.execute("UPDATE notifications SET read = 1")
    await db.commit()


# ── Task States ──────────────────────────────────────────────────────────

async def get_task_state(task_id: str) -> Optional[dict]:
    db = await get_db()
    return await _fetchone(db, "SELECT * FROM task_states WHERE task_id = ?", (task_id,))


async def get_all_task_states() -> dict[str, dict]:
    """Get all task states as a dict keyed by task_id."""
    db = await get_db()
    rows = await _fetchall(db, "SELECT * FROM task_states")
    return {r["task_id"]: r for r in rows}


async def get_latest_runs_for_tasks(task_ids: list[str]) -> dict[str, dict]:
    """Get the latest completed/failed run for each task_id."""
    if not task_ids:
        return {}
    db = await get_db()
    placeholders = ",".join("?" for _ in task_ids)
    rows = await _fetchall(
        db,
        f"SELECT * FROM scan_runs WHERE task_id IN ({placeholders}) "
        "AND status IN ('completed', 'failed', 'partial') "
        "ORDER BY started_at DESC",
        task_ids,
    )
    result = {}
    for r in rows:
        tid = r["task_id"]
        if tid not in result:
            result[tid] = r
    return result


async def upsert_task_state(task_id: str, **kwargs: Any) -> None:
    invalid = set(kwargs.keys()) - VALID_TASK_STATE_COLUMNS
    if invalid:
        raise ValueError(f"Invalid column(s) for task_states: {invalid}")
    db = await get_db()
    existing = await get_task_state(task_id)
    if existing:
        sets = ", ".join(f"{k} = ?" for k in kwargs)
        vals = list(kwargs.values()) + [task_id]
        await db.execute(f"UPDATE task_states SET {sets} WHERE task_id = ?", vals)
    else:
        kwargs["task_id"] = task_id
        cols = ", ".join(kwargs.keys())
        placeholders = ", ".join("?" for _ in kwargs)
        await db.execute(f"INSERT INTO task_states ({cols}) VALUES ({placeholders})", list(kwargs.values()))
    await db.commit()


# ── Benchmark Runs ───────────────────────────────────────────────────────

async def create_benchmark(task_id: str, models: list[str]) -> str:
    db = await get_db()
    bench_id = _new_id()
    await db.execute(
        "INSERT INTO benchmark_runs (id, task_id, started_at, models, status) VALUES (?, ?, ?, ?, 'running')",
        (bench_id, task_id, _now(), json.dumps(models)),
    )
    await db.commit()
    return bench_id


async def complete_benchmark(bench_id: str) -> None:
    db = await get_db()
    await db.execute(
        "UPDATE benchmark_runs SET status = 'completed', completed_at = ? WHERE id = ?",
        (_now(), bench_id),
    )
    await db.commit()


async def insert_benchmark_result(benchmark_id: str, model_id: str, finding_count: int,
                                   time_taken: float, input_tokens: int, output_tokens: int,
                                   cost: float, findings_json: str) -> None:
    db = await get_db()
    await db.execute(
        """INSERT INTO benchmark_results (benchmark_id, model_id, finding_count, time_taken_seconds,
           input_tokens, output_tokens, estimated_cost, findings_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (benchmark_id, model_id, finding_count, time_taken, input_tokens, output_tokens, cost, findings_json),
    )
    await db.commit()


async def get_benchmarks(limit: int = 20) -> list[dict]:
    db = await get_db()
    return await _fetchall(db, "SELECT * FROM benchmark_runs ORDER BY started_at DESC LIMIT ?", (limit,))


async def get_benchmark_results(benchmark_id: str) -> list[dict]:
    db = await get_db()
    return await _fetchall(db, "SELECT * FROM benchmark_results WHERE benchmark_id = ?", (benchmark_id,))


# ── Cleanup ──────────────────────────────────────────────────────────────

async def cleanup_old_data(days: int) -> int:
    """Delete scan runs, findings, notifications, and benchmark data older than N days.
    Returns count of findings deleted."""
    if days <= 0:
        return 0
    db = await get_db()
    cursor = await db.execute(
        "DELETE FROM findings WHERE run_id IN (SELECT id FROM scan_runs WHERE started_at < datetime('now', ?))",
        (f"-{days} days",),
    )
    count = cursor.rowcount or 0
    await db.execute("DELETE FROM scan_runs WHERE started_at < datetime('now', ?)", (f"-{days} days",))
    await db.execute("DELETE FROM notifications WHERE created_at < datetime('now', ?)", (f"-{days} days",))
    await db.execute(
        "DELETE FROM benchmark_results WHERE benchmark_id IN "
        "(SELECT id FROM benchmark_runs WHERE started_at < datetime('now', ?))",
        (f"-{days} days",),
    )
    await db.execute("DELETE FROM benchmark_runs WHERE started_at < datetime('now', ?)", (f"-{days} days",))
    await db.commit()
    return count


async def delete_run(run_id: str) -> bool:
    """Delete a single run and its findings. Returns True if run existed."""
    db = await get_db()
    row = await _fetchone(db, "SELECT id FROM scan_runs WHERE id = ?", (run_id,))
    if not row:
        return False
    await db.execute("DELETE FROM findings WHERE run_id = ?", (run_id,))
    await db.execute("DELETE FROM notifications WHERE run_id = ?", (run_id,))
    await db.execute("DELETE FROM scan_runs WHERE id = ?", (run_id,))
    await db.commit()
    return True


async def delete_task_runs(task_id: str) -> int:
    """Delete all runs and findings for a task. Returns count of runs deleted."""
    db = await get_db()
    run_ids = await _fetchall(db, "SELECT id FROM scan_runs WHERE task_id = ?", (task_id,))
    if not run_ids:
        return 0
    ids = [r["id"] for r in run_ids]
    placeholders = ",".join("?" * len(ids))
    await db.execute(f"DELETE FROM findings WHERE run_id IN ({placeholders})", ids)
    await db.execute(f"DELETE FROM notifications WHERE run_id IN ({placeholders})", ids)
    await db.execute(f"DELETE FROM scan_runs WHERE task_id = ?", (task_id,))
    await db.commit()
    return len(ids)


# ── Finding Management ──────────────────────────────────────────────────

async def get_open_findings(task_id: str = "", limit: int = 100) -> list[dict]:
    """Get open (non-dismissed) findings, optionally filtered by task_id."""
    db = await get_db()
    if task_id:
        return await _fetchall(
            db,
            "SELECT * FROM findings WHERE task_id = ? AND status = 'open' "
            "ORDER BY severity, file_path, line_number LIMIT ?",
            (task_id, limit),
        )
    return await _fetchall(
        db,
        "SELECT * FROM findings WHERE status = 'open' "
        "ORDER BY severity, file_path, line_number LIMIT ?",
        (limit,),
    )


async def get_finding(finding_id: int) -> Optional[dict]:
    """Get a single finding by ID."""
    db = await get_db()
    return await _fetchone(db, "SELECT * FROM findings WHERE id = ?", (finding_id,))


async def dismiss_finding(finding_id: int, reason: str = "", dismissed_by: str = "") -> bool:
    """Mark a finding as dismissed."""
    db = await get_db()
    cursor = await db.execute(
        "UPDATE findings SET status = 'dismissed', dismissed_reason = ?, dismissed_at = ?, dismissed_by = ? WHERE id = ?",
        (reason, _now(), dismissed_by, finding_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def request_fix(finding_id: int) -> bool:
    """Mark a finding as having a fix requested."""
    db = await get_db()
    cursor = await db.execute(
        "UPDATE findings SET status = 'fix_pending', fix_requested_at = ? WHERE id = ? AND status = 'open'",
        (_now(), finding_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def mark_fix_applied(finding_id: int) -> bool:
    """Mark a finding's fix as applied."""
    db = await get_db()
    cursor = await db.execute(
        "UPDATE findings SET status = 'fix_applied', fix_applied_at = ? WHERE id = ? AND status IN ('fix_pending', 'open')",
        (_now(), finding_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def mark_fix_verified(finding_id: int) -> bool:
    """Mark a finding's fix as verified (re-scan confirmed the fix worked)."""
    db = await get_db()
    cursor = await db.execute(
        "UPDATE findings SET status = 'fix_verified', fix_verified_at = ? WHERE id = ? AND status = 'fix_applied'",
        (_now(), finding_id),
    )
    await db.commit()
    return cursor.rowcount > 0


async def reopen_finding(finding_id: int) -> bool:
    """Reopen a dismissed finding."""
    db = await get_db()
    cursor = await db.execute(
        "UPDATE findings SET status = 'open', dismissed_reason = NULL, dismissed_at = NULL WHERE id = ?",
        (finding_id,),
    )
    await db.commit()
    return cursor.rowcount > 0


async def get_findings_summary_by_task(task_id: str) -> dict:
    """Get finding counts grouped by status for a task."""
    db = await get_db()
    rows = await _fetchall(
        db,
        "SELECT status, COUNT(*) as count FROM findings WHERE task_id = ? GROUP BY status",
        (task_id,),
    )
    return {r["status"]: r["count"] for r in rows}


async def get_findings_grouped(group_by: str = "file", task_id: str = "") -> list[dict]:
    """Get open findings grouped by file, rule, or severity."""
    db = await get_db()
    where = "WHERE status = 'open'"
    params: list = []
    if task_id:
        where += " AND task_id = ?"
        params.append(task_id)

    if group_by == "file":
        return await _fetchall(
            db,
            f"SELECT file_path, COUNT(*) as count, "
            f"GROUP_CONCAT(DISTINCT severity) as severities "
            f"FROM findings {where} GROUP BY file_path ORDER BY count DESC",
            params,
        )
    elif group_by == "rule":
        return await _fetchall(
            db,
            f"SELECT rule_id, category, COUNT(*) as count, "
            f"GROUP_CONCAT(DISTINCT severity) as severities "
            f"FROM findings {where} GROUP BY rule_id ORDER BY count DESC",
            params,
        )
    elif group_by == "severity":
        return await _fetchall(
            db,
            f"SELECT severity, COUNT(*) as count FROM findings {where} GROUP BY severity",
            params,
        )
    return []
