"""Context-aware suppression filters for reducing false positives."""

from __future__ import annotations

import os
import re
from typing import Optional


# ── LLM Provider Usage Context Detection ─────────────────────────────────
# These patterns identify lines where LLM provider names are used in a
# technical/usage context (model configs, imports, API references) rather
# than in an authorship/attribution context.

LLM_USAGE_CONTEXT_PATTERNS = [
    # Model ID strings: "anthropic/claude-sonnet-4-6", "openai/gpt-4.1"
    r"""["'](?:anthropic|openai|gemini|mistral|groq|xai|deepseek|ollama)/[a-zA-Z0-9\-._]+["']""",
    # Environment variable names for API keys
    r"""[A-Z_]*(?:OPENAI|ANTHROPIC|GEMINI|CLAUDE|MISTRAL|GROQ)[A-Z_]*_(?:KEY|TOKEN|SECRET)""",
    # Config objects: "openai": {
    r"""["'](?:openai|anthropic|gemini|mistral|groq|xai|deepseek|ollama)["']\s*[:=]\s*[{"]""",
    # Python imports
    r"""(?:from|import)\s+(?:litellm|openai|anthropic|google\.generativeai)""",
    # LiteLLM reference
    r"""\blitellm\b""",
    # UI labels/values referencing models
    r"""(?:value|label|model|name)\s*[:=]\s*["'].*(?:OpenAI|Anthropic|Claude|Gemini|GPT|gpt-)""",
    # Provider lists
    r"""(?:OpenAI|Anthropic),?\s+(?:Anthropic|Google|xAI|Mistral|Groq|DeepSeek|Ollama)""",
    # Provider/model configuration context
    r"""(?:providers?|models?)\s*(?:[\(:=]|include|support|for)\s*.*(?:OpenAI|Anthropic|Claude|Gemini)""",
    # Format/spec references
    r"""(?:OpenAI|Anthropic|Google)\s+(?:format|schema|style|compatible|spec)""",
    # Pricing strings
    r"""\$[\d.]+/\$[\d.]+\s+per""",
    # Console/platform URLs
    r"""(?:console\.anthropic|platform\.openai|aistudio\.google)""",
    # Product descriptions
    r"""(?:provides?|makes?)\s+(?:GPT|Claude|Gemini|AI)\s+(?:models?|assistant)""",
    # Package/config references
    r"""(?:name\s*=\s*"openai"|{.*name.*openai.*}|\.tar\.gz|\.whl)""",
    # Name field values
    r"""["']?name["']?\s*[:=]\s*["'](?:OpenAI|Anthropic|Google)\s*(?:\([^)]*\))?["']""",
    # Title/description fields
    r"""(?:title|description|desc)\s*[:=]\s*["'].*(?:OpenAI|Anthropic|Claude|Gemini|API\s+[Kk]ey)""",
    # YAML config blocks
    r"""^\s*(?:openai|anthropic|gemini|mistral|groq|xai|deepseek|ollama)\s*:\s*\{""",
    # Markdown list items
    r"""^\s*[-*]\s+(?:OpenAI|Anthropic|Google)\s*\(""",
    # Table rows with provider names
    r"""[│|].*(?:OpenAI|Anthropic|Gemini).*(?:[│|]|configured|Add key)""",
    # Specific model name strings
    r"""["']claude-(?:haiku|sonnet|opus)[\-\d.]*["']""",
    r"""["']gemini-[\d.]+[\-a-z]*["']""",
    r"""["']gpt-[\d.]+[\-a-z]*["']""",
    # Technical operations
    r"""(?:caching|streaming|batching|routing)\s*\(.*(?:Anthropic|OpenAI|Google)""",
    # Backtick model references
    r"""`[a-z]+/[a-z0-9\-._]+`\s*[—\-]""",
    # "running/using" context
    r"""(?:running|using|via|through|with)\s+(?:Claude|OpenAI|Anthropic|Gemini|GPT)""",
    # Arrow model references
    r"""→\s*`[a-z]+/[a-z0-9\-._]+`""",
    # Pricing context
    r"""\(\$[\d.]+.*(?:token|bench|reason|generation)""",
    # Provider field values
    r"""["']provider["']\s*:\s*["'](?:anthropic|openai|gemini|mistral|groq|xai|deepseek|ollama)["']""",
    # UI display context
    r"""(?:changed?\s+to|display|show|strip|prefix|abbreviat)\s+.*(?:claude|gpt|gemini)[\-\w]*""",
    # Backtick model IDs
    r"""`(?:anthropic/)?claude-[\w\-.]+`""",
    r"""`(?:openai/)?gpt-[\w\-.]+`""",
    r"""`(?:gemini/)?gemini-[\w\-.]+`""",
    # Function calling context
    r"""(?:function[\-_]?calling|tool[\-_]?call(?:ing)?|tools?)\s+.*(?:schema|format|OpenAI)""",
    r"""OpenAI\s+function[\-_]?call""",
    # Models array
    r"""["']models["']\s*:\s*\[""",
]

_LLM_USAGE_RE = [re.compile(p, re.IGNORECASE) for p in LLM_USAGE_CONTEXT_PATTERNS]


def is_llm_usage_context(line: str) -> bool:
    """Check if a line uses LLM provider names in a technical/usage context."""
    return any(r.search(line) for r in _LLM_USAGE_RE)


# ── Context-Requires Filter ──────────────────────────────────────────────

def check_context_requires(line: str, context_requires: str) -> bool:
    """Check if line matches the context_requires pattern (proximity check)."""
    if not context_requires:
        return True  # No context requirement, always match
    try:
        return bool(re.search(context_requires, line, re.IGNORECASE))
    except re.error:
        return False


# ── File-Level Filters ───────────────────────────────────────────────────

SKIP_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg", ".webp",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".pdf", ".zip", ".tar", ".gz", ".bz2",
    ".wasm", ".pyc", ".pyo", ".so", ".dll",
    ".mp3", ".mp4", ".wav", ".ogg", ".webm",
    ".DS_Store", ".exe", ".bin",
}

SKIP_PATH_SEGMENTS = [
    "node_modules/", ".git/", "__pycache__/", "venv/", ".venv/",
    "dist/", "build/", ".next/", ".nuxt/",
]

PROVIDER_SKIP_FILES = {
    "uv.lock", "poetry.lock", "Pipfile.lock",
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "requirements.txt", "pyproject.toml", "Cargo.lock",
}


def should_skip_file(filepath: str) -> bool:
    """Check if a file should be skipped based on extension or path."""
    _, ext = os.path.splitext(filepath)
    if ext.lower() in SKIP_EXTENSIONS:
        return True
    for seg in SKIP_PATH_SEGMENTS:
        if seg in filepath:
            return True
    return False


def is_provider_skip_file(filepath: str) -> bool:
    """Check if file is a dependency/lock file where provider names are expected."""
    return os.path.basename(filepath) in PROVIDER_SKIP_FILES
