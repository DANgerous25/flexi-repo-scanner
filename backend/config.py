"""Application configuration models."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel, Field


CONFIG_DIR = Path(os.environ.get("FRS_CONFIG_DIR", "config"))
DATA_DIR = Path(os.environ.get("FRS_DATA_DIR", "data"))


# ── Helpers ──────────────────────────────────────────────────────────────

_ENV_RE = re.compile(r"\$\{([^}]+)\}")


def _interpolate(value: Any) -> Any:
    """Replace ${ENV_VAR} references — checks encrypted vault first, then env."""
    if isinstance(value, str):
        def _replace(m: re.Match) -> str:
            var_name = m.group(1)
            # Try the vault first
            try:
                from backend.storage.secrets import get_vault
                vault = get_vault()
                vault_val = vault.get(var_name)
                if vault_val is not None:
                    return vault_val
            except Exception:
                pass  # Vault not initialised yet — fall back to env
            return os.environ.get(var_name, m.group(0))
        return _ENV_RE.sub(_replace, value)
    if isinstance(value, dict):
        return {k: _interpolate(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_interpolate(v) for v in value]
    return value


# ── Settings Models ──────────────────────────────────────────────────────

class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8400


class SmtpConfig(BaseModel):
    host: str = ""
    port: int = 587
    tls: bool = True
    username: str = ""
    password: str = ""
    from_address: str = ""
    from_name: str = "Flexi Repo Scanner"


class LlmModelConfig(BaseModel):
    id: str
    name: str


class LlmProviderConfig(BaseModel):
    api_key: str = ""
    base_url: str = ""
    models: list[LlmModelConfig] = Field(default_factory=list)
    enabled: bool = True


class LlmConfig(BaseModel):
    """Top-level LLM configuration with fallback ordering."""
    fallback_order: list[str] = Field(default_factory=list)
    providers: dict[str, LlmProviderConfig] = Field(default_factory=dict)


class RetentionConfig(BaseModel):
    results_days: int = 30
    max_days: int = 0  # 0 = unlimited


class AppSettings(BaseModel):
    server: ServerConfig = Field(default_factory=ServerConfig)
    smtp: SmtpConfig = Field(default_factory=SmtpConfig)
    llm: LlmConfig = Field(default_factory=LlmConfig)
    retention: RetentionConfig = Field(default_factory=RetentionConfig)


# ── Connection Models ────────────────────────────────────────────────────

class GitHubConnection(BaseModel):
    id: str
    name: str
    owner: str
    repo: str
    token: str = ""
    default_branch: str = "main"


class ConnectionsConfig(BaseModel):
    connections: list[GitHubConnection] = Field(default_factory=list)


# ── Task Models ──────────────────────────────────────────────────────────

class TaskSchedule(BaseModel):
    cron: str = ""
    timezone: str = "UTC"


class ScanRule(BaseModel):
    id: str
    name: str
    pattern: str
    severity: str = "medium"
    case_sensitive: bool = True
    context_requires: str = ""


class AllowlistEntry(BaseModel):
    file: str = ""
    pattern: str = ""
    match: str = ""
    rules: list[str] = Field(default_factory=list)
    reason: str = ""


class ContextFilter(BaseModel):
    type: str
    enabled: bool = True


class LlmScanConfig(BaseModel):
    model: str = ""  # keep for backwards compat
    preferred_models: list[str] = Field(default_factory=list)  # up to 3, in priority order
    prompt_template: str = ""
    prompt: str = ""
    focus: list[str] = Field(default_factory=list)
    max_files_per_run: int = 50


class ScanConfig(BaseModel):
    mode: str = "full"  # "full" or "diff"
    type: str = "pattern"  # "pattern", "llm-review", "doc-coverage"
    paths: dict[str, list[str]] = Field(default_factory=lambda: {
        "include": ["**/*"],
        "exclude": ["node_modules/", "*.lock", "dist/", "build/", "__pycache__/"],
    })
    rules: list[ScanRule] = Field(default_factory=list)
    llm: LlmScanConfig = Field(default_factory=LlmScanConfig)
    allowlist: list[AllowlistEntry] = Field(default_factory=list)
    context_filters: list[ContextFilter] = Field(default_factory=list)


class TaskAction(BaseModel):
    type: str  # "email-report", "generate-fix-prompt", "github-issue", "in-app-notify"
    trigger: str = "findings"  # "always", "findings", "fixed"
    recipients: list[str] = Field(default_factory=list)
    template: str = ""
    output: str = "file"
    labels: list[str] = Field(default_factory=list)
    assign: str = ""


class TaskConfig(BaseModel):
    id: str = ""
    name: str = ""
    description: str = ""
    active: bool = True
    connection: str = ""
    schedule: TaskSchedule = Field(default_factory=TaskSchedule)
    scan: ScanConfig = Field(default_factory=ScanConfig)
    actions: list[TaskAction] = Field(default_factory=list)
    task_builder_prompt: str = ""
