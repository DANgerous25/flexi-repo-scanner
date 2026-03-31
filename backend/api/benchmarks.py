"""LLM benchmark comparison API routes."""

from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import LlmScanConfig
from backend.llm import router as llm
from backend.llm.pricing import estimate_cost
from backend.scanner.github import GitHubClient, filter_files
from backend.scanner.llm_review import review_files
from backend.storage import config_loader, db

router = APIRouter(prefix="/api/benchmarks", tags=["benchmarks"])


class BenchmarkRequest(BaseModel):
    task_id: str
    models: list[str]  # e.g. ["anthropic/claude-sonnet-4-6", "openai/gpt-4.1-mini"]


@router.get("")
async def list_benchmarks(limit: int = 20):
    """List benchmark runs."""
    benchmarks = await db.get_benchmarks(limit)
    # Enrich with results
    for b in benchmarks:
        b["results"] = await db.get_benchmark_results(b["id"])
        if isinstance(b.get("models"), str):
            b["models"] = json.loads(b["models"])
    return benchmarks


@router.get("/{benchmark_id}")
async def get_benchmark(benchmark_id: str):
    """Get benchmark results."""
    benchmarks = await db.get_benchmarks(100)
    bench = None
    for b in benchmarks:
        if b["id"] == benchmark_id:
            bench = b
            break
    if not bench:
        raise HTTPException(404, "Benchmark not found")

    results = await db.get_benchmark_results(benchmark_id)
    for r in results:
        if r.get("findings_json"):
            r["findings"] = json.loads(r["findings_json"])
            del r["findings_json"]

    if isinstance(bench.get("models"), str):
        bench["models"] = json.loads(bench["models"])

    return {"benchmark": bench, "results": results}


@router.post("")
async def run_benchmark(req: BenchmarkRequest):
    """Start a benchmark run comparing models."""
    task = config_loader.load_task(req.task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    if task.scan.type != "llm-review":
        raise HTTPException(400, "Benchmarks only supported for LLM review tasks")
    if len(req.models) < 2:
        raise HTTPException(400, "Select at least 2 models")

    settings = config_loader.load_settings()
    benchmark_id = await db.create_benchmark(req.task_id, req.models)

    # Run in background
    async def _run():
        try:
            conn = config_loader.get_connection(task.connection)
            if not conn:
                return

            client = GitHubClient(owner=conn.owner, repo=conn.repo, token=conn.token)
            try:
                branch = conn.default_branch
                files = await client.list_files(branch)
                include = task.scan.paths.get("include", ["**/*"])
                exclude = task.scan.paths.get("exclude", [])
                filtered = filter_files(files, include, exclude)

                # Get file contents (limited)
                max_files = task.scan.llm.max_files_per_run or 20
                file_contents: dict[str, str] = {}
                for f in filtered[:max_files]:
                    content = await client.get_file_content(f.path, ref=branch)
                    if content:
                        file_contents[f.path] = content

                # Run each model
                for model_id in req.models:
                    llm_config = LlmScanConfig(
                        model=model_id,
                        prompt_template=task.scan.llm.prompt_template,
                        prompt=task.scan.llm.prompt,
                        focus=task.scan.llm.focus,
                        max_files_per_run=max_files,
                    )

                    result = await review_files(file_contents, llm_config, settings, task.scan.llm.focus)

                    cost = estimate_cost(
                        model_id,
                        result.get("input_tokens", 0),
                        result.get("output_tokens", 0),
                    )

                    await db.insert_benchmark_result(
                        benchmark_id=benchmark_id,
                        model_id=model_id,
                        finding_count=len(result.get("findings", [])),
                        time_taken=result.get("time_seconds", 0),
                        input_tokens=result.get("input_tokens", 0),
                        output_tokens=result.get("output_tokens", 0),
                        cost=cost,
                        findings_json=json.dumps(result.get("findings", [])),
                    )

                await db.complete_benchmark(benchmark_id)
            finally:
                await client.close()
        except Exception as e:
            # Mark benchmark as failed
            db_conn = await db.get_db()
            await db_conn.execute(
                "UPDATE benchmark_runs SET status = 'failed', completed_at = datetime('now') WHERE id = ?",
                (benchmark_id,),
            )
            await db_conn.commit()

    asyncio.create_task(_run())
    return {"benchmark_id": benchmark_id, "message": "Benchmark started"}
