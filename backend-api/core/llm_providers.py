"""Simple global LLM provider - one config for entire app"""

import json
import os
import asyncio
from typing import List, Dict, Optional, Literal, Union
from fastapi import HTTPException

from config.pipeline_config import get_llm_defaults

_llm_cfg = get_llm_defaults()

# Global configuration - pipeline.json is the source, env vars override
# Pipeline nodes own their own model config; these globals are a safety net only
LLM_PROVIDER = os.getenv("LLM_PROVIDER") or _llm_cfg["provider"]
LLM_MODEL = os.getenv("LLM_MODEL") or _llm_cfg["model"]
_TIMEOUT = _llm_cfg.get("timeout", 60)
_RETRY_ATTEMPTS = _llm_cfg.get("retry_attempts", 3)
_RETRY_BACKOFF_BASE = _llm_cfg.get("retry_backoff_base", 2)
_TOKEN_ESTIMATION_MULTIPLIER = _llm_cfg.get("token_estimation_multiplier", 1.3)
_TOKEN_LIMIT = _llm_cfg.get("token_limit", 100000)
_SEED = _llm_cfg.get("seed")
_LOGPROBS = _llm_cfg.get("logprobs")


def get_available_providers() -> List[str]:
    """Return list of providers with configured API keys"""
    providers = []
    if os.getenv("GROQ_API_KEY"):
        providers.append("groq")
    if os.getenv("OPENAI_API_KEY"):
        providers.append("openai")
    if os.getenv("ANTHROPIC_API_KEY"):
        providers.append("anthropic")
    return providers

async def llm_call(
    messages: List[Dict[str, str]],
    max_tokens: int = 1000,
    system: Optional[str] = None,
    tools: Optional[List[Dict]] = None,
    stop_sequences: Optional[List[str]] = None,
    temperature: float = 0.7,
    output_format: Literal["text", "json", "schema"] = "text",
    schema: Optional[Dict] = None,
    model: Optional[str] = None,
    seed: Optional[int] = None,
    logprobs: Optional[int] = None,
) -> Union[str, Dict]:
    """Universal LLM function - uses global provider config.

    Args:
        model: Override the global LLM_MODEL for this call. When None, uses
            the globally configured model.
    """
    effective_model = model or LLM_MODEL

    # Request validation - prevent guaranteed failures
    total_tokens = sum(len(m.get('content', '').split()) for m in messages) * _TOKEN_ESTIMATION_MULTIPLIER
    if total_tokens > _TOKEN_LIMIT:
        raise HTTPException(400, "Request exceeds token limit")

    if system:
        messages = [{"role": "system", "content": system}] + messages

    params = {
        "model": effective_model,
        "messages": messages, 
        "max_tokens": max_tokens,
        "temperature": temperature
    }
    if tools: params["tools"] = tools
    if stop_sequences: params["stop"] = stop_sequences

    # Reproducibility and diagnostics (OpenAI/Groq only)
    effective_seed = seed if seed is not None else _SEED
    if effective_seed is not None and LLM_PROVIDER in ["openai", "groq"]:
        params["seed"] = effective_seed
    effective_logprobs = logprobs if logprobs is not None else _LOGPROBS
    if effective_logprobs is not None and LLM_PROVIDER in ["openai", "groq"]:
        params["logprobs"] = True
        params["top_logprobs"] = effective_logprobs
    
    # Handle structured output
    if output_format == "json" and LLM_PROVIDER in ["openai", "groq"]:
        params["response_format"] = {"type": "json_object"}
    elif output_format == "schema" and schema and LLM_PROVIDER in ["openai", "groq"]:
        params["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "response_schema", "schema": schema}
        }
    
    
    # Get API key and create client based on provider
    if LLM_PROVIDER == "openai":
        from openai import AsyncOpenAI
        api_key = os.getenv("OPENAI_API_KEY")
        client = AsyncOpenAI(api_key=api_key)

    elif LLM_PROVIDER == "groq":
        from groq import AsyncGroq
        api_key = os.getenv("GROQ_API_KEY")
        client = AsyncGroq(api_key=api_key)

    elif LLM_PROVIDER == "anthropic":
        import anthropic
        api_key = os.getenv("ANTHROPIC_API_KEY")
        client = anthropic.AsyncAnthropic(api_key=api_key)
    else:
        raise ValueError(f"Unknown provider: {LLM_PROVIDER}")

    if not api_key:
        raise ValueError(f"API key not found for {LLM_PROVIDER}")

    # Retry logic with exponential backoff
    for attempt in range(_RETRY_ATTEMPTS):
        try:
            # Anthropic uses different API structure
            if LLM_PROVIDER == "anthropic":
                anthropic_params = {
                    "model": effective_model,
                    "messages": [m for m in messages if m["role"] != "system"],
                    "max_tokens": max_tokens,
                    "temperature": temperature
                }
                if system:
                    anthropic_params["system"] = system
                if stop_sequences:
                    anthropic_params["stop_sequences"] = stop_sequences
                response = await asyncio.wait_for(client.messages.create(**anthropic_params), timeout=_TIMEOUT)
                content = response.content[0].text if response.content else ""
            else:
                # OpenAI/Groq use same API
                response = await asyncio.wait_for(client.chat.completions.create(**params), timeout=_TIMEOUT)
                content = response.choices[0].message.content if response.choices else ""

            # Parse JSON if needed
            if output_format in ["json", "schema"]:
                return json.loads(content)
            return content

        except asyncio.TimeoutError:
            if attempt == _RETRY_ATTEMPTS - 1:
                raise HTTPException(503, "LLM request timeout")
            await asyncio.sleep(_RETRY_BACKOFF_BASE ** attempt)
        except Exception as e:
            status = getattr(e, "status_code", None)
            if status and 400 <= status < 500:
                raise HTTPException(status, f"LLM client error: {str(e)}")
            if attempt == _RETRY_ATTEMPTS - 1:
                raise HTTPException(503, f"LLM error: {str(e)}")
            await asyncio.sleep(_RETRY_BACKOFF_BASE ** attempt)