"""Regex-based pattern scanning engine."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from backend.config import AllowlistEntry, ContextFilter, ScanRule
from backend.scanner.context import (
    check_context_requires,
    is_llm_usage_context,
    is_provider_skip_file,
    should_skip_file,
)


@dataclass
class Finding:
    category: str
    file_path: str
    line_number: int
    severity: str
    rule_id: str
    description: str
    matched_text: str
    context: str


def _compile_rule(rule: ScanRule) -> Optional[re.Pattern]:
    """Compile a scan rule's regex pattern."""
    try:
        flags = 0 if rule.case_sensitive else re.IGNORECASE
        return re.compile(rule.pattern, flags)
    except re.error:
        return None


def _is_allowlisted(
    file_path: str,
    matched_text: str,
    rule_id: str,
    allowlist: list[AllowlistEntry],
) -> bool:
    """Check if a finding is allowlisted."""
    import os
    basename = os.path.basename(file_path)

    for entry in allowlist:
        # File-level allowlist
        if entry.file:
            file_match = file_path.endswith(entry.file) or basename == entry.file
            if file_match:
                if not entry.rules or rule_id in entry.rules:
                    return True

        # Pattern-level allowlist
        if entry.pattern:
            try:
                if re.search(entry.pattern, matched_text):
                    if not entry.rules or rule_id in entry.rules:
                        return True
            except re.error:
                pass

        # Exact match allowlist
        if entry.match:
            if entry.match in matched_text:
                if not entry.rules or rule_id in entry.rules:
                    return True

    return False


def _has_context_filter(filters: list[ContextFilter], filter_type: str) -> bool:
    """Check if a specific context filter is enabled."""
    return any(f.type == filter_type and f.enabled for f in filters)


def scan_file_content(
    file_path: str,
    content: str,
    rules: list[ScanRule],
    allowlist: list[AllowlistEntry],
    context_filters: list[ContextFilter],
) -> list[Finding]:
    """Scan file content against pattern rules. Returns list of findings."""
    findings = []
    compiled = [(rule, _compile_rule(rule)) for rule in rules]
    use_llm_filter = _has_context_filter(context_filters, "llm-provider-usage")
    is_dep_file = is_provider_skip_file(file_path)

    lines = content.split("\n")
    for line_num, line in enumerate(lines, 1):
        line_is_llm_usage = is_llm_usage_context(line) if use_llm_filter else False

        for rule, pattern in compiled:
            if pattern is None:
                continue

            # Context-requires check
            if rule.context_requires and not check_context_requires(line, rule.context_requires):
                continue

            match = pattern.search(line)
            if not match:
                continue

            matched_text = match.group(0)

            # Allowlist check
            if _is_allowlisted(file_path, line, rule.id, allowlist):
                continue

            # LLM provider usage context suppression
            if use_llm_filter and line_is_llm_usage:
                # Heuristic: if the rule id or name suggests it's about provider names
                # and the line is in a usage context, suppress it
                provider_keywords = {"provider", "claude", "openai", "anthropic", "gemini",
                                    "gpt", "chatgpt", "perplexity", "mistral", "groq"}
                rule_lower = (rule.id + " " + rule.name).lower()
                if any(kw in rule_lower for kw in provider_keywords):
                    continue

            # Dep file suppression for provider names
            if is_dep_file:
                provider_keywords = {"provider", "claude", "openai", "anthropic", "gemini",
                                    "gpt", "chatgpt", "perplexity", "mistral", "groq"}
                rule_lower = (rule.id + " " + rule.name).lower()
                if any(kw in rule_lower for kw in provider_keywords):
                    continue

            # Build context snippet
            context = line.strip()
            if len(context) > 200:
                start = max(0, match.start() - 50)
                end = min(len(context), match.end() + 50)
                context = "..." + context[start:end] + "..."

            findings.append(Finding(
                category=rule.name,
                file_path=file_path,
                line_number=line_num,
                severity=rule.severity,
                rule_id=rule.id,
                description=rule.name,
                matched_text=matched_text,
                context=context,
            ))

    return findings
