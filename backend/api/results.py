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
        writer.writerow({k: f.get(k, "") for k in writer.fieldnames})

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=findings-{run_id}.csv"},
    )


class AnalyzeFindingRequest(BaseModel):
    finding: dict
    file_content: str = ""
    task_id: str = ""


@router.post("/analyze")
async def analyze_finding(req: AnalyzeFindingRequest):
    """Use LLM to analyze a finding for validity in context."""
    settings = config_loader.load_settings()

    prompt = f"""You are a senior code security and quality expert.
Analyze this finding for validity:

FILE: {req.finding.get('file', 'unknown')}
LINE: {req.finding.get('line', 'unknown')}
SEVERITY: {req.finding.get('severity', 'medium')}
CATEGORY: {req.finding.get('category', 'unknown')}
RULE: {req.finding.get('rule_name', 'unknown')}
MATCHED TEXT: {req.finding.get('matched_text', '')}
DESCRIPTION: {req.finding.get('description', req.finding.get('context', ''))}

FILE CONTEXT (first 1500 chars):
{req.file_content[:1500]}

Is this a real issue or false positive? Provide concise reasoning, confidence (high/medium/low), and recommended action (fix/ignore/allowlist)."""

    result = await llm.complete(
        model="auto",
        messages=[{"role": "user", "content": prompt}],
        settings=settings,
        temperature=0.2,
        max_tokens=800,
    )

    return {
        "analysis": result.get("content", "No response from LLM."),
        "model": result.get("model", "unknown"),
        "tokens": {
            "input": result.get("input_tokens", 0),
            "output": result.get("output_tokens", 0),
        },
    }
