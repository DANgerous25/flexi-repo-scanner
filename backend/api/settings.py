"""Settings management API routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import AppSettings
from backend.llm import router as llm
from backend.storage import config_loader

router = APIRouter(prefix="/api/settings", tags=["settings"])


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
        if data["smtp"].get("password") == "***":
            data["smtp"]["password"] = current_data["smtp"]["password"]

    if "llm" in data and "providers" in data.get("llm", {}):
        for provider, cfg in data["llm"]["providers"].items():
            if isinstance(cfg, dict) and cfg.get("api_key", "").startswith("***"):
                existing = current_data.get("llm", {}).get("providers", {}).get(provider, {})
                cfg["api_key"] = existing.get("api_key", "")

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
        await aiosmtplib.send(
            msg,
            hostname=smtp.host,
            port=smtp.port,
            username=smtp.username or None,
            password=smtp.password or None,
            use_tls=smtp.tls,
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
