"""Scan results browsing API routes."""

from __future__ import annotations

import csv
import io
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel

from backend.llm import router as llm
from backend.storage import config_loader, db

router = APIRouter(prefix="/api/results", tags=["results"])


@router.get("/findings")
async def list_findings(task_id: str = "", status: str = "open", group_by: str = "", limit: int = 100):
    """Get findings across all runs, with optional filtering and grouping."""
    if group_by:
        return await db.get_findings_grouped(group_by=group_by, task_id=task_id)
    if status == "open":
        return await db.get_open_findings(task_id=task_id, limit=limit)
    db_conn = await db.get_db()
    if task_id:
        rows = await db_conn.execute_fetchall(
            "SELECT * FROM findings WHERE task_id = ? AND status = ? ORDER BY severity, file_path LIMIT ?",
            (task_id, status, limit),
        )
    else:
        rows = await db_conn.execute_fetchall(
            "SELECT * FROM findings WHERE status = ? ORDER BY severity, file_path LIMIT ?",
            (status, limit),
        )
    return [dict(r) for r in rows]


@router.get("/findings/{finding_id}")
async def get_finding(finding_id: int):
    """Get a single finding by ID."""
    finding = await db.get_finding(finding_id)
    if not finding:
        raise HTTPException(404, "Finding not found")
    return finding


class DismissRequest(BaseModel):
    reason: str = ""
    dismissed_by: str = ""


@router.post("/findings/{finding_id}/dismiss")
async def dismiss_finding(finding_id: int, req: DismissRequest):
    """Dismiss a finding with a reason."""
    if not await db.dismiss_finding(finding_id, req.reason, req.dismissed_by):
        raise HTTPException(404, "Finding not found")
    # Also add to the task's allowlist if it has a task_id
    finding = await db.get_finding(finding_id)
    if finding and finding.get("task_id"):
        try:
            from backend.storage import config_loader
            task = config_loader.load_task(finding["task_id"])
            if task:
                from backend.config import AllowlistEntry
                task.scan.allowlist.append(AllowlistEntry(
                    file=finding.get("file_path", ""),
                    match=finding.get("matched_text", ""),
                    rules=[finding.get("rule_id", "")],
                    reason=f"Dismissed: {req.reason}" if req.reason else "Dismissed via UI",
                    finding_id=str(finding_id),
                ))
                config_loader.save_task(task)
        except Exception:
            pass
    return {"message": "Finding dismissed"}


@router.post("/findings/{finding_id}/reopen")
async def reopen_finding(finding_id: int):
    """Reopen a dismissed finding."""
    if not await db.reopen_finding(finding_id):
        raise HTTPException(404, "Finding not found or not dismissable")
    return {"message": "Finding reopened"}


@router.post("/findings/{finding_id}/request-fix")
async def request_fix_for_finding(finding_id: int):
    """Mark a finding as needing a fix."""
    if not await db.request_fix(finding_id):
        raise HTTPException(404, "Finding not found or not in open status")
    return {"message": "Fix requested"}


@router.post("/findings/{finding_id}/mark-fixed")
async def mark_finding_fixed(finding_id: int):
    """Mark a finding's fix as applied."""
    if not await db.mark_fix_applied(finding_id):
        raise HTTPException(404, "Finding not found")
    return {"message": "Finding marked as fixed"}


@router.get("/recent")
async def recent_runs(limit: int = 20):
    """Get recent scan runs across all tasks."""
    return await db.get_recent_runs(limit)


@router.get("/{run_id}")
async def get_run(run_id: str):
    """Get details of a specific scan run."""
    run = await db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@router.get("/{run_id}/findings")
async def get_findings(run_id: str):
    """Get all findings for a scan run."""
    run = await db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")
    findings = await db.get_run_findings(run_id)
    summary = await db.get_findings_summary(run_id)
    return {
        "run": run,
        "findings": findings,
        "summary": summary,
    }


@router.get("/{run_id}/export/json")
async def export_json(run_id: str):
    """Export findings as JSON."""
    findings = await db.get_run_findings(run_id)
    return Response(
        content=json.dumps(findings, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=findings-{run_id}.json"},
    )


@router.get("/{run_id}/export/csv")
async def export_csv(run_id: str):
    """Export findings as CSV."""
    findings = await db.get_run_findings(run_id)
    if not findings:
        return PlainTextResponse("No findings", status_code=200)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "file_path", "line_number", "severity", "category", "rule_id", "description", "matched_text", "context"
    ])
    writer.writeheader()
    for f in findings:
        row = {}
        for k in writer.fieldnames:
            val = str(f.get(k, ""))
            if val and val[0] in ("=", "+", "-", "@", "\t", "\r"):
                val = "'" + val
            row[k] = val
        writer.writerow(row)

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=findings-{run_id}.csv"},
    )


class AnalyzeFindingRequest(BaseModel):
    finding: dict
    file_content: str = ""
    task_id: str = ""


@router.get("/{run_id}/diff")
async def diff_run(run_id: str):
    """Compare a run's findings against the previous run for the same task."""
    run = await db.get_run(run_id)
    if not run:
        raise HTTPException(404, "Run not found")

    task_id = run.get("task_id")
    if not task_id:
        raise HTTPException(400, "Run has no task_id")

    current_findings = await db.get_run_findings(run_id)
    current_set = {
        (f["file_path"], f["line_number"], f["rule_id"], f.get("matched_text", ""))
        for f in current_findings
    }

    task_runs = await db.get_task_runs(task_id, 10)
    previous_run = None
    for tr in task_runs:
        if tr["id"] != run_id and tr.get("status") == "completed":
            previous_run = tr
            break

    previous_set = set()
    if previous_run:
        prev_findings = await db.get_run_findings(previous_run["id"])
        previous_set = {
            (f["file_path"], f["line_number"], f["rule_id"], f.get("matched_text", ""))
            for f in prev_findings
        }

    new_findings = current_set - previous_set
    fixed_findings = previous_set - current_set
    persistent_findings = current_set & previous_set

    return {
        "run_id": run_id,
        "previous_run_id": previous_run["id"] if previous_run else None,
        "summary": {
            "new": len(new_findings),
            "fixed": len(fixed_findings),
            "persistent": len(persistent_findings),
            "total_current": len(current_findings),
            "total_previous": len(previous_set),
        },
        "new_findings": [dict(zip(("file_path", "line_number", "rule_id", "matched_text"), f)) for f in sorted(new_findings)],
        "fixed_findings": [dict(zip(("file_path", "line_number", "rule_id", "matched_text"), f)) for f in sorted(fixed_findings)],
    }


@router.post("/analyze")
async def analyze_finding(req: AnalyzeFindingRequest):
    """Use LLM to analyze a finding for validity in context."""
    settings = config_loader.load_settings()

    prompt = f"""You are a senior code security and quality expert.
Analyze this finding for validity and output ONLY valid JSON (no other text):

{{
  "analysis": "detailed reasoning if real issue or false positive, with context from the code",
  "is_valid": true/false,
  "confidence": "high/medium/low",
  "recommended_action": "fix/ignore/allowlist",
  "suggested_fix_prompt": "a detailed prompt that can be pasted into an AI coding agent to fix this specific issue (include the exact code change suggestion)"
}}

FILE: {req.finding.get('file', 'unknown')}
LINE: {req.finding.get('line', 'unknown')}
SEVERITY: {req.finding.get('severity', 'medium')}
CATEGORY: {req.finding.get('category', 'unknown')}
RULE: {req.finding.get('rule_name', 'unknown')}
MATCHED TEXT: {req.finding.get('matched_text', '')}
DESCRIPTION: {req.finding.get('description', req.finding.get('context', ''))}

FILE CONTEXT (first 1500 chars):
{req.file_content[:1500]}"""

    result = await llm.complete(
        model="auto",
        messages=[{"role": "user", "content": prompt}],
        settings=settings,
        temperature=0.2,
        max_tokens=800,
    )

    analysis_text = result.get("content", "No response from LLM.")
    try:
        parsed = json.loads(analysis_text.strip())
        return {
            "analysis": parsed,
            "raw": analysis_text,
            "model": result.get("model", "unknown"),
            "tokens": {
                "input": result.get("input_tokens", 0),
                "output": result.get("output_tokens", 0),
            },
        }
    except (json.JSONDecodeError, ValueError):
        return {
            "analysis": analysis_text,
            "model": result.get("model", "unknown"),
            "tokens": {
                "input": result.get("input_tokens", 0),
                "output": result.get("output_tokens", 0),
            },
        }
