"""LLM router — wraps LiteLLM for multi-provider model access with fallback."""

from __future__ import annotations

import logging
import os
import time
from typing import Any, Optional

from backend.config import AppSettings, LlmConfig

logger = logging.getLogger(__name__)


# ── Provider → env var mapping ──────────────────────────────────────────

PROVIDER_ENV_MAP: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "groq": "GROQ_API_KEY",
    "xai": "XAI_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "cohere": "COHERE_API_KEY",
    "together_ai": "TOGETHERAI_API_KEY",
    "fireworks_ai": "FIREWORKS_AI_API_KEY",
    "anyscale": "ANYSCALE_API_KEY",
    "perplexity": "PERPLEXITYAI_API_KEY",
    "replicate": "REPLICATE_API_KEY",
    "huggingface": "HUGGINGFACE_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "voyage": "VOYAGE_API_KEY",
}


def _configure_providers(llm_config: LlmConfig) -> None:
    """Set environment variables for LiteLLM from provider configs."""
    for provider_name, provider in llm_config.providers.items():
        if not provider.enabled:
            continue

        # Set API key as env var
        if provider.api_key:
            env_var = PROVIDER_ENV_MAP.get(provider_name)
            if env_var:
                os.environ[env_var] = provider.api_key

        # Set base_url for Ollama or custom endpoints
        if provider.base_url:
            if provider_name == "ollama":
                os.environ["OLLAMA_API_BASE"] = provider.base_url


def _get_provider_for_model(model: str) -> str:
    """Extract provider name from a LiteLLM model string like 'anthropic/claude-3'."""
    if "/" in model:
        return model.split("/")[0]
    return ""


def _is_resolved(value: str) -> bool:
    """Check if a config value is actually set (not an unresolved ${...} placeholder)."""
    if not value:
        return False
    return not (value.startswith("${") and value.endswith("}"))


def _provider_is_available(provider_name: str, llm_config: LlmConfig) -> bool:
    """Check if a provider is configured and enabled."""
    provider = llm_config.providers.get(provider_name)
    if not provider or not provider.enabled:
        return False
    # Ollama only needs base_url, others need api_key
    if provider_name == "ollama":
        return _is_resolved(provider.base_url)
    return _is_resolved(provider.api_key) or _is_resolved(provider.base_url)


def resolve_model(requested_model: str, llm_config: LlmConfig) -> list[str]:
    """Resolve a model request to a list of models to try, in fallback order.

    If the requested model's provider is available, try it first.
    Then try equivalent models from providers in the fallback_order list.

    Returns a list of LiteLLM model strings to attempt in order.
    """
    models_to_try = []

    # 1. Try the explicitly requested model first (unless "auto")
    provider = _get_provider_for_model(requested_model)
    if requested_model != "auto" and provider and _provider_is_available(provider, llm_config):
        models_to_try.append(requested_model)

    # 2. Walk the fallback_order and pick the first available model from each
    for fallback_provider in llm_config.fallback_order:
        if fallback_provider == provider:
            continue  # already tried

        fb = llm_config.providers.get(fallback_provider)
        if not fb or not fb.enabled:
            continue
        if not _provider_is_available(fallback_provider, llm_config):
            continue

        # Use that provider's first configured model
        if fb.models:
            fb_model = fb.models[0].id
            # Ensure proper LiteLLM prefix
            if "/" not in fb_model:
                fb_model = f"{fallback_provider}/{fb_model}"
            if fb_model not in models_to_try:
                models_to_try.append(fb_model)

    # 3. If nothing from fallback_order, try any configured+enabled provider
    if not models_to_try:
        for pname, pcfg in llm_config.providers.items():
            if pcfg.enabled and pcfg.models and _provider_is_available(pname, llm_config):
                m = pcfg.models[0].id
                if "/" not in m:
                    m = f"{pname}/{m}"
                if m not in models_to_try:
                    models_to_try.append(m)

    return models_to_try


async def complete(
    model: str,
    messages: list[dict[str, str]],
    settings: AppSettings,
    temperature: float = 0.0,
    max_tokens: int = 4096,
) -> dict:
    """Send a completion request via LiteLLM with fallback.

    Returns dict with: content, input_tokens, output_tokens, model, time_seconds
    Tries each model in the fallback chain until one succeeds.
    """
    import litellm

    _configure_providers(settings.llm)

    models_to_try = resolve_model(model, settings.llm)
    if not models_to_try:
        return {
            "content": "",
            "input_tokens": 0,
            "output_tokens": 0,
            "model": model,
            "time_seconds": 0,
            "error": f"No available provider for model '{model}'. Check LLM settings and fallback_order.",
        }

    logger.info("LLM request: trying %s (fallback chain: %s)", models_to_try[0], " → ".join(models_to_try))

    last_error = ""
    for attempt_model in models_to_try:
        start = time.time()
        try:
            response = await litellm.acompletion(
                model=attempt_model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            elapsed = time.time() - start

            content = response.choices[0].message.content or ""
            usage = response.usage

            logger.info(
                "LLM response from %s: %d input tokens, %d output tokens, %.1fs",
                attempt_model,
                usage.prompt_tokens if usage else 0,
                usage.completion_tokens if usage else 0,
                elapsed,
            )

            if models_to_try[0] != attempt_model:
                logger.info(
                    "Fallback: %s → %s succeeded", models_to_try[0], attempt_model
                )

            return {
                "content": content,
                "input_tokens": usage.prompt_tokens if usage else 0,
                "output_tokens": usage.completion_tokens if usage else 0,
                "model": attempt_model,
                "time_seconds": round(elapsed, 2),
            }
        except Exception as e:
            elapsed = time.time() - start
            last_error = str(e)
            logger.warning(
                "LLM call failed for %s (%.1fs): %s", attempt_model, elapsed, last_error
            )
            continue

    return {
        "content": "",
        "input_tokens": 0,
        "output_tokens": 0,
        "model": model,
        "time_seconds": 0,
        "error": f"All providers failed. Last error: {last_error}",
    }


async def complete_single(
    model: str,
    messages: list[dict[str, str]],
    settings: AppSettings,
    temperature: float = 0.0,
    max_tokens: int = 4096,
) -> dict:
    """Single-model completion with NO fallback. Used for benchmarking."""
    import litellm

    _configure_providers(settings.llm)

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
    """Test if a model is accessible (no fallback)."""
    result = await complete_single(
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


def get_available_models(settings: AppSettings) -> list[dict]:
    """Get list of all configured models across providers."""
    models = []
    for provider_name, provider_config in settings.llm.providers.items():
        has_creds = bool(provider_config.api_key or provider_config.base_url)
        for m in provider_config.models:
            models.append({
                "id": m.id,
                "name": m.name,
                "provider": provider_name,
                "configured": has_creds and provider_config.enabled,
            })
    return models
