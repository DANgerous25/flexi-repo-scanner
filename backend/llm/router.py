"""LLM router — wraps LiteLLM for multi-provider model access."""

from __future__ import annotations

import time
from typing import Any, Optional

from backend.config import AppSettings


async def complete(
    model: str,
    messages: list[dict[str, str]],
    settings: AppSettings,
    temperature: float = 0.0,
    max_tokens: int = 4096,
) -> dict:
    """Send a completion request via LiteLLM.

    Returns dict with: content, input_tokens, output_tokens, model, time_seconds
    """
    import litellm

    # Configure provider API keys from settings
    _configure_providers(settings)

    start = time.time()
    try:
        response = await litellm.acompletion(
            model=model,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        elapsed = time.time() - start

        content = response.choices[0].message.content or ""
        usage = response.usage

        return {
            "content": content,
            "input_tokens": usage.prompt_tokens if usage else 0,
            "output_tokens": usage.completion_tokens if usage else 0,
            "model": model,
            "time_seconds": round(elapsed, 2),
        }
    except Exception as e:
        elapsed = time.time() - start
        return {
            "content": "",
            "input_tokens": 0,
            "output_tokens": 0,
            "model": model,
            "time_seconds": round(elapsed, 2),
            "error": str(e),
        }


async def test_model(model: str, settings: AppSettings) -> dict:
    """Test if a model is accessible."""
    result = await complete(
        model=model,
        messages=[{"role": "user", "content": "Reply with 'OK' and nothing else."}],
        settings=settings,
        max_tokens=10,
    )
    return {
        "ok": "error" not in result,
        "model": model,
        "response": result.get("content", ""),
        "error": result.get("error", ""),
        "time_seconds": result["time_seconds"],
    }


def _configure_providers(settings: AppSettings) -> None:
    """Set environment variables for LiteLLM from settings."""
    import os

    provider_env_map = {
        "anthropic": "ANTHROPIC_API_KEY",
        "openai": "OPENAI_API_KEY",
        "groq": "GROQ_API_KEY",
        "xai": "XAI_API_KEY",
        "mistral": "MISTRAL_API_KEY",
        "deepseek": "DEEPSEEK_API_KEY",
    }

    for provider_name, provider_config in settings.llm.items():
        if provider_config.api_key:
            env_var = provider_env_map.get(provider_name)
            if env_var:
                os.environ[env_var] = provider_config.api_key

        if provider_config.base_url and provider_name == "ollama":
            os.environ["OLLAMA_API_BASE"] = provider_config.base_url


def get_available_models(settings: AppSettings) -> list[dict]:
    """Get list of all configured models across providers."""
    models = []
    for provider_name, provider_config in settings.llm.items():
        has_key = bool(provider_config.api_key or provider_config.base_url)
        for m in provider_config.models:
            models.append({
                "id": m.id,
                "name": m.name,
                "provider": provider_name,
                "configured": has_key,
            })
    return models
