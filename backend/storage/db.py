"""SQLite database for scan results, notifications, and benchmarks."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import aiosqlite

from backend.config import DATA_DIR

DB_PATH = DATA_DIR / "scanner.db"

_db: Optional[aiosqlite.Connection] = None


async def get_db() -> aiosqlite.Connection:
    global _db
    if _db is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _db = await aiosqlite.connect(str(DB_PATH))
        _db.row_factory = aiosqlite.Row
        await _db.execute("PRAGMA journal_mode=WAL")
        await _db.execute("PRAGMA foreign_keys=ON")
        await _init_schema(_db)
    return _db


async def close_db() -> None:
    global _db
    if _db:
        await _db.close()
        _db = None


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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


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
    db = await get_db()
    sets = ", ".join(f"{k} = ?" for k in kwargs)
    vals = list(kwargs.values())
    vals.append(run_id)
    await db.execute(f"UPDATE scan_runs SET {sets} WHERE id = ?", vals)
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


async def get_run(run_id: str) -> Optional[dict]:
    db = await get_db()
    row = await db.execute_fetchall("SELECT * FROM scan_runs WHERE id = ?", (run_id,))
    return dict(row[0]) if row else None


async def get_task_runs(task_id: str, limit: int = 50) -> list[dict]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM scan_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?",
        (task_id, limit),
    )
    return [dict(r) for r in rows]


async def get_recent_runs(limit: int = 20) -> list[dict]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT ?", (limit,)
    )
    return [dict(r) for r in rows]


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
    rows = await db.execute_fetchall(
        "SELECT * FROM findings WHERE run_id = ? ORDER BY severity, file_path, line_number",
        (run_id,),
    )
    return [dict(r) for r in rows]


async def get_findings_summary(run_id: str) -> dict:
    db = await get_db()
    rows = await db.execute_fetchall(
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
    where = "WHERE read = 0" if unread_only else ""
    rows = await db.execute_fetchall(
        f"SELECT * FROM notifications {where} ORDER BY created_at DESC LIMIT ?", (limit,)
    )
    return [dict(r) for r in rows]


async def get_unread_count() -> int:
    db = await get_db()
    rows = await db.execute_fetchall("SELECT COUNT(*) as c FROM notifications WHERE read = 0")
    return rows[0]["c"] if rows else 0


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
    rows = await db.execute_fetchall("SELECT * FROM task_states WHERE task_id = ?", (task_id,))
    return dict(rows[0]) if rows else None


async def upsert_task_state(task_id: str, **kwargs: Any) -> None:
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
    rows = await db.execute_fetchall(
        "SELECT * FROM benchmark_runs ORDER BY started_at DESC LIMIT ?", (limit,)
    )
    return [dict(r) for r in rows]


async def get_benchmark_results(benchmark_id: str) -> list[dict]:
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT * FROM benchmark_results WHERE benchmark_id = ?", (benchmark_id,)
    )
    return [dict(r) for r in rows]


# ── Cleanup ──────────────────────────────────────────────────────────────

async def cleanup_old_data(days: int) -> int:
    """Delete scan runs and findings older than N days. Returns count deleted."""
    if days <= 0:
        return 0
    db = await get_db()
    cutoff = datetime.now(timezone.utc).isoformat()
    # Simple approach: delete runs older than N days
    cursor = await db.execute(
        "DELETE FROM findings WHERE run_id IN (SELECT id FROM scan_runs WHERE started_at < datetime('now', ?))",
        (f"-{days} days",),
    )
    count = cursor.rowcount
    await db.execute("DELETE FROM scan_runs WHERE started_at < datetime('now', ?)", (f"-{days} days",))
    await db.commit()
    return count
