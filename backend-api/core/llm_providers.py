"""Simple global LLM provider - one config for entire app"""

import json
import logging
import os
import asyncio
from typing import Literal
from fastapi import HTTPException

logger = logging.getLogger(__name__)

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


def get_available_providers() -> list[str]:
    """Return list of providers with configured API keys"""
    providers = []
    if os.getenv("GROQ_API_KEY"):
        providers.append("groq")
    if os.getenv("OPENAI_API_KEY"):
        providers.append("openai")
    if os.getenv("ANTHROPIC_API_KEY"):
        providers.append("anthropic")
    return providers


def _is_token_limit_error(e: Exception) -> bool:
    """Detect errors caused by structured output exceeding max_tokens."""
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        error = body.get("error", {})
        if isinstance(error, dict):
            if error.get("code") == "json_validate_failed":
                return True
            if "max completion tokens" in str(error.get("message", "")):
                return True
    return "json_validate_failed" in str(e) or "max completion tokens" in str(e)


def _format_api_error(e: Exception) -> str:
    """Extract concise error summary from LLM provider exceptions."""
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        error = body.get("error", {})
        if isinstance(error, dict):
            code = error.get("code", "")
            msg = error.get("message", str(e))
            if len(msg) > 120:
                msg = msg[:120] + "…"
            return f"{code}: {msg}" if code else msg
    raw = str(e)
    return raw if len(raw) <= 150 else raw[:150] + "…"


async def llm_call(
    messages: list[dict[str, str]],
    max_tokens: int | None = 1000,
    system: str | None = None,
    tools: list[dict] | None = None,
    stop_sequences: list[str] | None = None,
    temperature: float = 0.7,
    output_format: Literal["text", "json", "schema"] = "text",
    schema: dict | None = None,
    model: str | None = None,
    seed: int | None = None,
    logprobs: int | None = None,
    reasoning_effort: Literal["low", "medium", "high"] | None = None,
    warnings: list[str] | None = None,
    usage_out: dict | None = None,
) -> str | dict:
    """Universal LLM function - uses global provider config.

    Args:
        model: Override the global LLM_MODEL for this call. When None, uses
            the globally configured model.
        usage_out: Optional dict the caller supplies to receive per-call
            token usage. When provided and the provider returns a usage
            object, populated with ``{"input": prompt_tokens, "output":
            completion_tokens}`` before return. Left untouched on timeout /
            retry paths where no single call succeeded.
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
        "temperature": temperature
    }
    if max_tokens is not None:
        params["max_tokens"] = max_tokens
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
    if reasoning_effort is not None and LLM_PROVIDER in ["openai", "groq"]:
        params["reasoning_effort"] = reasoning_effort
    
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
                    "max_tokens": max_tokens if max_tokens is not None else 8192,
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
                if not content and response.choices:
                    msg = response.choices[0].message
                    reasoning = getattr(msg, "reasoning", None) or ""
                    if reasoning:
                        logger.warning(
                            "[LLM] Empty content, falling back to reasoning field (%d chars)",
                            len(reasoning),
                        )
                        if warnings is not None:
                            warnings.append("empty_content_reasoning_fallback")
                        content = reasoning

            # Detect output truncation by max_tokens
            if LLM_PROVIDER == "anthropic":
                truncated = getattr(response, "stop_reason", None) == "max_tokens"
            else:
                _fr = response.choices[0].finish_reason if response.choices else None
                truncated = _fr == "length"

            if truncated and output_format in ("json", "schema") and max_tokens is not None:
                _mt = params.get("max_tokens", max_tokens)
                logger.warning(
                    "[LLM] Structured output truncated (max_tokens=%s) — retrying without limit", _mt,
                )
                if warnings is not None:
                    warnings.append(f"Structured output truncated (max_tokens={_mt}) — retried without limit")
                params.pop("max_tokens", None)
                max_tokens = None
                continue

            # Capture provider-reported token usage when the caller asked for it.
            # OpenAI/Groq expose prompt_tokens/completion_tokens on response.usage;
            # Anthropic exposes input_tokens/output_tokens. Missing fields default
            # to 0 so the dict shape is always stable for downstream aggregation.
            if usage_out is not None:
                u = getattr(response, "usage", None)
                if u is not None:
                    if LLM_PROVIDER == "anthropic":
                        usage_out["input"] = int(getattr(u, "input_tokens", 0) or 0)
                        usage_out["output"] = int(getattr(u, "output_tokens", 0) or 0)
                    else:
                        usage_out["input"] = int(getattr(u, "prompt_tokens", 0) or 0)
                        usage_out["output"] = int(getattr(u, "completion_tokens", 0) or 0)

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
            if status == 429:
                if attempt == _RETRY_ATTEMPTS - 1:
                    raise HTTPException(429, f"LLM rate limited: {_format_api_error(e)}")
                await asyncio.sleep(_RETRY_BACKOFF_BASE ** attempt)
                continue
            if status and 400 <= status < 500:
                if _is_token_limit_error(e) and max_tokens is not None:
                    _mt = params.get("max_tokens", max_tokens)
                    logger.warning(
                        "[LLM] Token limit error (max_tokens=%s) — retrying without limit", _mt,
                    )
                    if warnings is not None:
                        warnings.append(f"Token limit error (max_tokens={_mt}) — retried without limit")
                    params.pop("max_tokens", None)
                    max_tokens = None
                    continue
                if status == 404:
                    detail = f"Model not found: {_format_api_error(e)}"
                elif status == 401:
                    detail = f"Auth failed: {_format_api_error(e)}"
                else:
                    detail = f"{status}: {_format_api_error(e)}"
                logger.error("[LLM] %s", detail)
                # Param-validation errors ("not one of the allowed values",
                # "invalid_request_error") are the caller's fault — surface
                # as 4xx, not 502. 502 Bad Gateway implies the upstream is
                # broken, which is misleading when the client sent a bad
                # enum value. Optimizers watching for CLIENT vs SERVER
                # (see PromptPotter's ErrorCategory) can then short-circuit
                # on the offending candidate instead of retrying.
                raw_detail = detail.lower()
                is_param_validation = (
                    "not one of the allowed values" in raw_detail
                    or "invalid_request_error" in raw_detail
                    or "invalid_enum" in raw_detail
                    or "is not a valid" in raw_detail
                )
                raise HTTPException(400 if is_param_validation else 502, detail)
            if attempt == _RETRY_ATTEMPTS - 1:
                raise HTTPException(503, f"LLM error: {_format_api_error(e)}")
            await asyncio.sleep(_RETRY_BACKOFF_BASE ** attempt)