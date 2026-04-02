"""LLM-powered code review and analysis scanning."""

from __future__ import annotations

import json
from typing import Any

from backend.config import AppSettings, LlmScanConfig
from backend.llm import router as llm
from backend.llm.pricing import estimate_cost


# ── Built-in Prompt Templates ────────────────────────────────────────────

PROMPT_TEMPLATES: dict[str, dict[str, str]] = {
    "security-review": {
        "system": """You are a security code reviewer. Analyze the provided code for security vulnerabilities including:
- SQL injection, XSS, CSRF
- Authentication and authorization flaws
- Input validation issues
- Insecure cryptography
- Path traversal, command injection
- Hardcoded secrets or credentials
- Insecure deserialization
- Missing rate limiting

For each finding, output JSON with this schema:
{
  "findings": [
    {
      "file": "path/to/file",
      "line": 42,
      "severity": "critical|high|medium|low",
      "category": "Security",
      "description": "Brief description",
      "suggestion": "How to fix it"
    }
  ],
  "summary": "Overall assessment"
}

Only report actual issues, not style preferences. If no issues found, return empty findings array.""",
    },
    "code-quality": {
        "system": """You are a code quality reviewer. Analyze the provided code for:
- Excessive complexity (deeply nested logic, long functions)
- Code duplication
- Poor naming conventions
- Dead or unreachable code
- Missing error handling
- Resource leaks
- Anti-patterns specific to the language

For each finding, output JSON:
{
  "findings": [
    {
      "file": "path/to/file",
      "line": 42,
      "severity": "high|medium|low|info",
      "category": "Code Quality",
      "description": "Brief description",
      "suggestion": "How to improve"
    }
  ],
  "quality_score": 85,
  "summary": "Overall assessment"
}""",
    },
    "code-review": {
        "system": """You are an experienced code reviewer. Provide a thorough review focusing on:
- Logic correctness and edge cases
- Performance concerns
- Readability and maintainability
- Error handling completeness
- API design quality
- Test coverage gaps

For each finding, output JSON:
{
  "findings": [
    {
      "file": "path/to/file",
      "line": 42,
      "severity": "high|medium|low|info",
      "category": "Code Review",
      "description": "Issue description",
      "suggestion": "Recommended change"
    }
  ],
  "summary": "Overall review"
}""",
    },
    "doc-coverage": {
        "system": """You are a documentation reviewer. Analyze the code for:
- Missing docstrings on public functions/classes/modules
- Stale or inaccurate comments
- Missing or incomplete README sections
- Undocumented API endpoints
- Missing type hints
- Unclear parameter descriptions

Output JSON:
{
  "findings": [
    {
      "file": "path/to/file",
      "line": 42,
      "severity": "medium|low|info",
      "category": "Documentation",
      "description": "What's missing",
      "suggestion": "What to add"
    }
  ],
  "coverage_pct": 65,
  "summary": "Documentation assessment"
}""",
    },
    "license-audit": {
        "system": """You are a license compliance auditor. Analyze the code for:
- License compatibility issues
- Missing license headers
- Attribution requirements not met
- Copyleft license contamination
- Missing third-party notices

Output JSON:
{
  "findings": [
    {
      "file": "path/to/file",
      "line": 1,
      "severity": "high|medium|low",
      "category": "License",
      "description": "Issue description",
      "suggestion": "How to resolve"
    }
  ],
  "summary": "License compliance assessment"
}""",
    },
}


def get_template_prompt(template_name: str) -> str | None:
    """Get system prompt for a built-in template."""
    tmpl = PROMPT_TEMPLATES.get(template_name)
    return tmpl["system"] if tmpl else None


async def review_files(
    files: dict[str, str],  # {path: content}
    llm_config: LlmScanConfig,
    settings: AppSettings,
    focus: list[str] | None = None,
    use_fallback: bool = True,
) -> dict[str, Any]:
    """Run LLM review on a batch of files.

    Returns dict with: findings, input_tokens, output_tokens, cost, time_seconds
    Set use_fallback=False for benchmarking (tests a single model without fallback).
    """
    # Build system prompt
    system_prompt = ""
    if llm_config.prompt_template:
        system_prompt = get_template_prompt(llm_config.prompt_template) or ""
    if llm_config.prompt:
        system_prompt = llm_config.prompt
    if not system_prompt:
        system_prompt = get_template_prompt("code-review") or ""

    if focus:
        system_prompt += f"\n\nFocus areas: {', '.join(focus)}"

    # Build file content for review
    file_content = ""
    for path, content in files.items():
        # Truncate very large files
        if len(content) > 50000:
            content = content[:50000] + "\n... (truncated)"
        file_content += f"\n--- {path} ---\n{content}\n"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Review the following files:\n{file_content}"},
    ]

    # If no model specified in task config, use "auto" which resolves to
    # settings.llm.default_model (or fallback_order).
    model = llm_config.model or "auto"
    complete_fn = llm.complete if use_fallback else llm.complete_single
    result = await complete_fn(
        model=model,
        messages=messages,
        settings=settings,
        max_tokens=4096,
    )

    if result.get("error"):
        return {
            "findings": [],
            "error": result["error"],
            "input_tokens": 0,
            "output_tokens": 0,
            "cost": 0,
            "time_seconds": result["time_seconds"],
        }

    # Parse LLM response
    findings = _parse_llm_response(result["content"])
    cost = estimate_cost(model, result["input_tokens"], result["output_tokens"])

    return {
        "findings": findings,
        "input_tokens": result["input_tokens"],
        "output_tokens": result["output_tokens"],
        "cost": cost,
        "time_seconds": result["time_seconds"],
        "model_used": result.get("model", ""),
        "raw_response": result["content"],
    }


def _parse_llm_response(content: str) -> list[dict]:
    """Parse JSON findings from LLM response."""
    try:
        # Try to extract JSON from response
        # Handle markdown code blocks
        if "```json" in content:
            start = content.index("```json") + 7
            end = content.index("```", start)
            content = content[start:end].strip()
        elif "```" in content:
            start = content.index("```") + 3
            end = content.index("```", start)
            content = content[start:end].strip()

        data = json.loads(content)
        if isinstance(data, dict) and "findings" in data:
            return data["findings"]
        if isinstance(data, list):
            return data
    except (json.JSONDecodeError, ValueError):
        pass
    return []
