"""Token cost estimation per LLM provider/model."""

from __future__ import annotations

# Pricing per 1M tokens (input / output) in USD
# Updated periodically — these are approximate
MODEL_PRICING: dict[str, tuple[float, float]] = {
    # Anthropic
    "anthropic/claude-sonnet-4-6": (3.0, 15.0),
    "anthropic/claude-haiku-4-5": (0.80, 4.0),
    "anthropic/claude-opus-4": (15.0, 75.0),
    # OpenAI
    "openai/gpt-4.1": (2.0, 8.0),
    "openai/gpt-4.1-mini": (0.40, 1.60),
    "openai/gpt-4.1-nano": (0.10, 0.40),
    "openai/o3": (10.0, 40.0),
    "openai/o3-mini": (1.10, 4.40),
    "openai/o4-mini": (1.10, 4.40),
    # Groq
    "groq/llama-3.3-70b-versatile": (0.59, 0.79),
    "groq/llama-3.1-8b-instant": (0.05, 0.08),
    # xAI
    "xai/grok-4.1-fast": (5.0, 25.0),
    # Mistral
    "mistral/mistral-large-latest": (2.0, 6.0),
    "mistral/mistral-small-latest": (0.10, 0.30),
    # DeepSeek
    "deepseek/deepseek-chat": (0.27, 1.10),
    "deepseek/deepseek-reasoner": (0.55, 2.19),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate cost in USD for a given model and token counts."""
    pricing = MODEL_PRICING.get(model)
    if not pricing:
        # Check for partial matches (provider prefix)
        for key, val in MODEL_PRICING.items():
            if model.startswith(key.split("/")[0]):
                pricing = val
                break

    if not pricing:
        return 0.0  # Unknown model (e.g., local Ollama) = free

    input_cost, output_cost = pricing
    return (input_tokens * input_cost / 1_000_000) + (output_tokens * output_cost / 1_000_000)
