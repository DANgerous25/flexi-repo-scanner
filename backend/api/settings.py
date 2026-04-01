"""Settings management API routes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import AppSettings
from backend.llm import router as llm
from backend.storage import config_loader

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/settings", tags=["settings"])


# ── Vault helpers ─────────────────────────────────────────────────────

# Mapping of provider names → env-var names for API keys
_PROVIDER_ENV_MAP: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "xai": "XAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


def _store_secret(key: str, value: str) -> None:
    """Store a secret in the encrypted vault (best-effort)."""
    try:
        from backend.storage.secrets import get_vault
        vault = get_vault()
        vault.set(key, value)
        vault.save()
    except Exception as exc:
        logger.warning("Could not store secret %s in vault: %s", key, exc)


@router.get("")
async def get_settings():
    """Get current settings (with masked secrets)."""
    settings = config_loader.load_settings()
    data = settings.model_dump()

    # Mask SMTP password
    if data.get("smtp", {}).get("password"):
        data["smtp"]["password"] = "***"

    # Mask API keys in llm.providers
    providers = data.get("llm", {}).get("providers", {})
    for provider, cfg in providers.items():
        if isinstance(cfg, dict) and cfg.get("api_key"):
            key = cfg["api_key"]
            cfg["api_key"] = "***" + key[-4:] if len(key) > 4 else "***"

    return data


@router.put("")
async def update_settings(data: dict):
    """Update settings."""
    current = config_loader.load_settings()
    current_data = current.model_dump()

    # Merge — don't overwrite masked secrets
    if "smtp" in data:
        pwd = data["smtp"].get("password", "")
        if pwd == "***":
            data["smtp"]["password"] = current_data["smtp"]["password"]
        elif pwd and not pwd.startswith("${"):
            # Real new password — store in vault, keep placeholder in YAML
            _store_secret("SMTP_PASSWORD", pwd)
            data["smtp"]["password"] = "${SMTP_PASSWORD}"

    if "llm" in data and "providers" in data.get("llm", {}):
        for provider, cfg in data["llm"]["providers"].items():
            if not isinstance(cfg, dict):
                continue
            api_key = cfg.get("api_key", "")
            if api_key.startswith("***"):
                existing = current_data.get("llm", {}).get("providers", {}).get(provider, {})
                cfg["api_key"] = existing.get("api_key", "")
            elif api_key and not api_key.startswith("${"):
                # Real new key — store in vault
                env_var = _PROVIDER_ENV_MAP.get(provider, f"{provider.upper()}_API_KEY")
                _store_secret(env_var, api_key)
                cfg["api_key"] = "${" + env_var + "}"

    # Apply updates
    merged = {**current_data, **data}
    settings = AppSettings(**merged)
    config_loader.save_settings(settings)
    return {"message": "Settings updated"}


@router.post("/test-smtp")
async def test_smtp():
    """Test SMTP configuration."""
    import aiosmtplib
    from email.message import EmailMessage

    settings = config_loader.load_settings()
    smtp = settings.smtp

    if not smtp.host:
        raise HTTPException(400, "SMTP not configured")

    msg = EmailMessage()
    msg["Subject"] = "Flexi Repo Scanner — SMTP Test"
    msg["From"] = f"{smtp.from_name} <{smtp.from_address}>"
    msg["To"] = smtp.from_address
    msg.set_content("This is a test email from Flexi Repo Scanner.")

    try:
        # Port 465 = implicit SSL (use_tls), port 587 = STARTTLS (start_tls)
        implicit_ssl = smtp.tls and smtp.port == 465
        starttls = smtp.tls and not implicit_ssl
        await aiosmtplib.send(
            msg,
            hostname=smtp.host,
            port=smtp.port,
            username=smtp.username or None,
            password=smtp.password or None,
            use_tls=implicit_ssl,
            start_tls=starttls,
        )
        return {"ok": True, "message": "Test email sent"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/test-llm/{model_id:path}")
async def test_llm(model_id: str):
    """Test an LLM model connection."""
    settings = config_loader.load_settings()
    result = await llm.test_model(model_id, settings)
    return result


@router.get("/models")
async def list_models():
    """List all configured LLM models."""
    settings = config_loader.load_settings()
    return llm.get_available_models(settings)


@router.get("/secrets")
async def list_secrets():
    """List secret names (not values) stored in the vault."""
    try:
        from backend.storage.secrets import get_vault
        vault = get_vault()
        keys = vault.list_keys()
        return {"keys": keys, "count": len(keys)}
    except Exception:
        return {"keys": [], "count": 0}


@router.get("/openrouter-models")
async def list_openrouter_models():
    """Fetch available models from OpenRouter's public API."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get("https://openrouter.ai/api/v1/models")
            resp.raise_for_status()
            data = resp.json()
            # OpenRouter returns {"data": [{"id": "...", "name": "...", ...}]}
            models = data.get("data", [])
            return {
                "models": [
                    {"id": m["id"], "name": m.get("name", m["id"]), "pricing": m.get("pricing", {})}
                    for m in models
                ]
            }
    except Exception as e:
        raise HTTPException(502, f"Failed to fetch OpenRouter models: {e}")
