"""LLM provider dispatch — per-call provider, no global fallback.

Providers: openai/groq/openrouter (via ``AsyncOpenAI`` with ``base_url`` swap)
and anthropic (via ``AsyncAnthropic``). Provider must be specified explicitly
on each ``llm_call(provider=...)`` — typically sourced from each pipeline
node's ``config.provider`` (overridable per request via ``node_config``).
"""

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Literal

import jsonschema
from fastapi import HTTPException

from config.pipeline_config import get_llm_defaults
from core.log_format import (
    TAG_LLM,
    TAG_LLM_ERR,
    continuation,
    fmt_fields,
)
from utils.utils import RED, RESET

logger = logging.getLogger(__name__)

_llm_cfg = get_llm_defaults()

# Loop / budget knobs — non-provider; still sourced from pipeline.json llm_defaults.
_TIMEOUT = _llm_cfg.get("timeout", 60)
_RETRY_ATTEMPTS = _llm_cfg.get("retry_attempts", 3)
_RETRY_BACKOFF_BASE = _llm_cfg.get("retry_backoff_base", 2)
_TOKEN_ESTIMATION_MULTIPLIER = _llm_cfg.get("token_estimation_multiplier", 1.3)
_TOKEN_LIMIT = _llm_cfg.get("token_limit", 100000)
_SEED = _llm_cfg.get("seed")
_LOGPROBS = _llm_cfg.get("logprobs")
# Schema-mode self-repair budget. On a parse/validation failure llm_call re-prompts
# the model with the validation errors, up to this many times, before raising 422.
_STRUCTURED_REPAIR_ATTEMPTS = _llm_cfg.get("structured_repair_attempts", 2)
# Anthropic's API rejects requests where ``max_tokens`` is omitted. To honor the
# "no dataset-side default across all providers" contract, we substitute a sane
# floor when the caller passes ``None``. Set to a value safe for all current
# Anthropic models (claude-haiku-4-5 publishes 8192 max output tokens; opus/sonnet
# accept much higher). Override via ``llm_defaults.anthropic_max_tokens_default``
# in pipeline.json if you need more headroom on a specific deployment.
_ANTHROPIC_MAX_TOKENS_DEFAULT = _llm_cfg.get("anthropic_max_tokens_default", 8192)


@dataclass(frozen=True)
class ProviderSpec:
    """Wiring for one OpenAI-compatible provider."""

    display_name: str            # e.g. "Groq" — for logs / error messages
    api_key_env: str             # env var holding the API key
    base_url: str | None = None  # None ⇒ AsyncOpenAI default (openai.com)


_OPENAI_COMPAT_SPECS: dict[str, ProviderSpec] = {
    "openai": ProviderSpec("OpenAI", "OPENAI_API_KEY"),
    "groq": ProviderSpec(
        "Groq", "GROQ_API_KEY", base_url="https://api.groq.com/openai/v1"
    ),
    "openrouter": ProviderSpec(
        "OpenRouter", "OPENROUTER_API_KEY", base_url="https://openrouter.ai/api/v1"
    ),
}

_VALID_PROVIDERS = sorted(set(_OPENAI_COMPAT_SPECS) | {"anthropic"})


def get_available_providers() -> list[str]:
    """Return list of providers with configured API keys."""
    providers = []
    if os.getenv("GROQ_API_KEY"):
        providers.append("groq")
    if os.getenv("OPENAI_API_KEY"):
        providers.append("openai")
    if os.getenv("OPENROUTER_API_KEY"):
        providers.append("openrouter")
    if os.getenv("ANTHROPIC_API_KEY"):
        providers.append("anthropic")
    return providers


def _is_token_limit_error(e: Exception) -> bool:
    """Detect errors caused by structured output exceeding max_tokens.

    Note: ``json_validate_failed`` is deliberately NOT treated here. It is a
    schema-conformance failure, not a token-budget problem — and now unreachable,
    since schema mode no longer engages provider-native ``json_schema`` decoding.
    """
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        error = body.get("error", {})
        if isinstance(error, dict):
            if "max completion tokens" in str(error.get("message", "")):
                return True
    return "max completion tokens" in str(e)


def _schema_errors(instance: object, schema: dict) -> str:
    """Return a compact bullet list of schema-validation errors, or '' if valid."""
    validator = jsonschema.Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
    if not errors:
        return ""
    lines = []
    for err in errors[:8]:
        loc = "/".join(str(p) for p in err.path) or "(root)"
        lines.append(f"- {loc}: {err.message}")
    return "\n".join(lines)


def _note_repair(node_name: str | None, attempt: int, detail: str, warnings: list[str] | None) -> None:
    """Log + record a schema-repair re-prompt so it lands on disk, not just stdout."""
    reason = detail.splitlines()[0] if detail else ""
    header = fmt_fields(
        node_name or "llm",
        "schema repair · re-prompting",
        ("attempt", f"{attempt}/{_STRUCTURED_REPAIR_ATTEMPTS}"),
        ("reason", reason),
    )
    logger.warning("%s %s", TAG_LLM_ERR, header)
    if warnings is not None:
        warnings.append(f"schema_repair attempt={attempt}: {detail}")


def _append_repair_turn(messages: list[dict], bad_content: str, error_summary: str) -> None:
    """Append an assistant→user repair exchange so the model can self-correct.

    Mutates ``messages`` in place. The openai-compat ``params['messages']`` is the
    same list object, and the anthropic path rebuilds its messages from ``messages``
    each attempt — so both providers pick up the repair turn on the next call.
    """
    messages.append({"role": "assistant", "content": bad_content})
    messages.append(
        {
            "role": "user",
            "content": (
                "Your previous response did not satisfy the required JSON schema:\n"
                f"{error_summary}\n"
                "Reply with ONLY corrected JSON that satisfies the schema — no prose, no code fences."
            ),
        }
    )


def _format_api_error(e: Exception) -> str:
    """Extract upstream error detail from LLM provider exceptions.

    Returns the full ``{code}: {message}`` pair when the SDK exposes a
    structured body, otherwise the full exception ``str()``. **No truncation
    by design** — errors are first-class diagnostic signal (rate limits,
    quotas, param-validation hints) and downstream consumers (PromptPotter's
    classifier, operators tailing logs) need the complete upstream text.
    """
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        error = body.get("error", {})
        if isinstance(error, dict):
            code = error.get("code", "")
            msg = error.get("message", str(e))
            return f"{code}: {msg}" if code else msg
    return str(e)


def _extract_error_code(e: Exception) -> str | None:
    """Pull the upstream ``error.code`` (e.g. ``rate_limit_exceeded``) if present."""
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        error = body.get("error", {})
        if isinstance(error, dict):
            code = error.get("code")
            if code:
                return str(code)
    return None


def _extract_retry_after(exc: Exception) -> int | None:
    """Pull Retry-After (seconds) from a Groq/OpenAI SDK rate-limit exception.

    The SDK exposes the upstream httpx response on ``exc.response`` whose
    headers carry the canonical ``Retry-After`` hint. Falls back to parsing
    Groq's ``"try again in Xm Ys"`` body once at the boundary so downstream
    clients only ever need to honor the standard header.
    """
    resp = getattr(exc, "response", None)
    headers = getattr(resp, "headers", None) if resp is not None else None
    if headers is not None:
        val = headers.get("Retry-After") or headers.get("retry-after")
        if val:
            try:
                return int(float(val))
            except (TypeError, ValueError):
                pass
    m = re.search(r"try again in (?:(\d+)m)?\s*(\d+(?:\.\d+)?)\s*s", str(exc))
    if m:
        return int(int(m.group(1) or 0) * 60 + float(m.group(2)))
    return None


async def llm_call(
    messages: list[dict[str, str]],
    *,
    provider: str,
    model: str,
    max_tokens: int | None = None,
    system: str | None = None,
    tools: list[dict] | None = None,
    stop_sequences: list[str] | None = None,
    temperature: float = 0.7,
    output_format: Literal["text", "json", "schema"] = "text",
    schema: dict | None = None,
    seed: int | None = None,
    logprobs: int | None = None,
    reasoning_effort: Literal["low", "medium", "high"] | None = None,
    warnings: list[str] | None = None,
    usage_out: dict | None = None,
    node_name: str | None = None,
) -> str | dict:
    """Universal LLM dispatch — per-call ``provider`` + ``model``, no global fallback.

    Args:
        provider: One of ``openai`` / ``groq`` / ``openrouter`` / ``anthropic``.
            Required. Sourced from each node's ``config.provider`` block in
            ``pipeline.json``, overridable per request via ``node_config``.
        model: Model identifier. Required. (Was previously globally defaulted
            via ``LLM_MODEL`` env var — that env var is no longer consulted.)
        usage_out: Optional dict the caller supplies to receive per-call
            token usage. When provided and the provider returns a usage
            object, populated with ``{"input": prompt_tokens, "output":
            completion_tokens}`` before return. Left untouched on timeout /
            retry paths where no single call succeeded.
    """
    is_openai_compat = provider in _OPENAI_COMPAT_SPECS
    if not is_openai_compat and provider != "anthropic":
        raise ValueError(
            f"Unknown provider: {provider!r}. Valid: {', '.join(_VALID_PROVIDERS)}."
        )

    # Request validation - prevent guaranteed failures
    total_tokens = sum(len(m.get('content', '').split()) for m in messages) * _TOKEN_ESTIMATION_MULTIPLIER
    if total_tokens > _TOKEN_LIMIT:
        raise HTTPException(400, "Request exceeds token limit")

    # Per-LLM-node start line — one chokepoint, every node inherits.
    # Emits "[LLM ] {node} · {provider}:{model} · reasoning=X" so the operator
    # sees model + reasoning on every call. Input chars are already on the
    # [REQ ] line (for /matches calls); duplicating here was redundant.
    if node_name is not None:
        body = fmt_fields(
            node_name,
            f"{provider}:{model}",
            ("reasoning", reasoning_effort),
        )
        logger.info(f"{RED}{TAG_LLM} {body}{RESET}")

    if system:
        messages = [{"role": "system", "content": system}] + messages

    params: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens is not None:
        params["max_tokens"] = max_tokens
    if tools:
        params["tools"] = tools
    if stop_sequences:
        params["stop"] = stop_sequences

    # Reproducibility and diagnostics (OpenAI-compatible providers only)
    effective_seed = seed if seed is not None else _SEED
    if effective_seed is not None and is_openai_compat:
        params["seed"] = effective_seed
    effective_logprobs = logprobs if logprobs is not None else _LOGPROBS
    if effective_logprobs is not None and is_openai_compat:
        params["logprobs"] = True
        params["top_logprobs"] = effective_logprobs
    if reasoning_effort is not None and is_openai_compat:
        params["reasoning_effort"] = reasoning_effort

    # Structured output. Both ``json`` and ``schema`` ask openai-compat providers
    # for a JSON object; ``schema`` additionally validates the parsed result against
    # ``schema`` client-side and self-repairs (see the validate/repair loop below).
    # Provider-native ``json_schema`` constrained decoding is deliberately NOT used:
    # reasoning models (e.g. Groq gpt-oss-120b) fail its grammar validation ~50% of
    # the time, and it only covers openai-compat providers — client-side validation
    # is reliable and uniform across all four providers.
    if output_format in ("json", "schema") and is_openai_compat:
        params["response_format"] = {"type": "json_object"}

    # Construct provider client
    if is_openai_compat:
        spec = _OPENAI_COMPAT_SPECS[provider]
        from openai import AsyncOpenAI

        api_key = os.getenv(spec.api_key_env)
        client_kwargs: dict = {"api_key": api_key}
        if spec.base_url:
            client_kwargs["base_url"] = spec.base_url
        client = AsyncOpenAI(**client_kwargs)
    else:  # anthropic
        import anthropic

        api_key = os.getenv("ANTHROPIC_API_KEY")
        client = anthropic.AsyncAnthropic(api_key=api_key)

    if not api_key:
        raise ValueError(f"API key not found for {provider}")

    # Retry logic with exponential backoff. ``attempt`` advances only on transport
    # errors (timeout / 5xx); schema-repair re-issues use ``repair_attempt`` and a
    # bare ``continue`` so they never consume the transport-retry budget.
    attempt = 0
    repair_attempt = 0
    while True:
        try:
            # Anthropic uses different API structure
            if provider == "anthropic":
                # Anthropic's API requires max_tokens. The other providers accept
                # ``None`` and fall back to their own ceiling — to keep the contract
                # uniform across providers, auto-fill with a safe floor here.
                # Truncation still surfaces normally via the finish_reason="length"
                # path, so self-healing is not defeated.
                anthropic_max_tokens = (
                    max_tokens if max_tokens is not None else _ANTHROPIC_MAX_TOKENS_DEFAULT
                )
                if max_tokens is None:
                    logger.info(
                        "%s anthropic · max_tokens auto-filled · max=%d (caller passed None)",
                        TAG_LLM, anthropic_max_tokens,
                    )
                anthropic_params: dict = {
                    "model": model,
                    "messages": [m for m in messages if m["role"] != "system"],
                    "max_tokens": anthropic_max_tokens,
                    "temperature": temperature,
                }
                if system:
                    anthropic_params["system"] = system
                if stop_sequences:
                    anthropic_params["stop_sequences"] = stop_sequences
                response = await asyncio.wait_for(
                    client.messages.create(**anthropic_params), timeout=_TIMEOUT
                )
                content = response.content[0].text if response.content else ""
            else:
                # OpenAI-compatible providers (openai/groq/openrouter)
                response = await asyncio.wait_for(
                    client.chat.completions.create(**params), timeout=_TIMEOUT
                )
                # Some providers (notably reasoning models) ship a successful
                # response with ``message.content = None`` — coerce to "" so
                # the contract stays ``str | dict``, never ``None``. The
                # finish_reason / reasoning_chars warning below still fires.
                content = (
                    (response.choices[0].message.content or "") if response.choices else ""
                )
                # Reasoning models (e.g. Groq gpt-oss-120b) can spend their entire
                # output budget on the hidden ``reasoning`` field and return
                # ``content=""``. Emit a neutral advisory and let raw response shape
                # (finish_reason + reasoning_tokens) flow through ``usage_out``;
                # PromptPotter's classifier decides whether this is fatal. We do not
                # substitute the reasoning trace as content — it is internal monologue,
                # not an answer.
                if not content and response.choices:
                    msg = response.choices[0].message
                    reasoning = getattr(msg, "reasoning", None) or ""
                    fr = response.choices[0].finish_reason or "unknown"
                    header = fmt_fields(
                        node_name or "llm",
                        "empty content",
                        ("finish_reason", fr),
                        ("reasoning_chars", len(reasoning)),
                    )
                    logger.warning("%s %s", TAG_LLM_ERR, header)
                    if warnings is not None:
                        warnings.append(
                            f"content_empty: finish_reason={fr} reasoning_chars={len(reasoning)}"
                        )

            # Detect output truncation by max_tokens. Normalize ``finish_reason``
            # across providers so PromptPotter's classifier sees stable values.
            if provider == "anthropic":
                _raw_fr = getattr(response, "stop_reason", None)
                _ANTH_MAP = {
                    "end_turn": "stop",
                    "stop_sequence": "stop",
                    "max_tokens": "length",
                    "tool_use": "tool_use",
                }
                normalized_fr = _ANTH_MAP.get(_raw_fr or "", _raw_fr or "unknown")
                truncated = _raw_fr == "max_tokens"
            else:
                _raw_fr = response.choices[0].finish_reason if response.choices else None
                _OAI_MAP = {"tool_calls": "tool_use"}
                normalized_fr = _OAI_MAP.get(_raw_fr or "", _raw_fr or "unknown")
                truncated = _raw_fr == "length"

            if truncated and output_format in ("json", "schema") and max_tokens is not None:
                _mt = params.get("max_tokens", max_tokens)
                header = fmt_fields(
                    node_name or "llm",
                    "structured output truncated · retrying without max_tokens",
                    ("max_tokens", _mt),
                )
                logger.warning("%s %s", TAG_LLM_ERR, header)
                if warnings is not None:
                    warnings.append(f"Structured output truncated (max_tokens={_mt}) — retried without limit")
                params.pop("max_tokens", None)
                max_tokens = None
                continue

            # Capture provider-reported token usage when the caller asked for it.
            # OpenAI/Groq/OpenRouter expose prompt_tokens/completion_tokens on
            # response.usage; Anthropic exposes input_tokens/output_tokens.
            # Missing fields default to 0 so the dict shape is always stable
            # for downstream aggregation. ``reasoning`` (OpenAI-compat only),
            # ``finish_reason``, and ``max_tokens_requested`` are surfaced for
            # PromptPotter's classifier; ``max_tokens_requested`` echoes the
            # value actually sent (post-retry it can differ from the caller's
            # argument).
            if usage_out is not None:
                u = getattr(response, "usage", None)
                if u is not None:
                    if provider == "anthropic":
                        usage_out["input"] = int(getattr(u, "input_tokens", 0) or 0)
                        usage_out["output"] = int(getattr(u, "output_tokens", 0) or 0)
                    else:
                        usage_out["input"] = int(getattr(u, "prompt_tokens", 0) or 0)
                        usage_out["output"] = int(getattr(u, "completion_tokens", 0) or 0)
                        details = getattr(u, "completion_tokens_details", None)
                        if details is not None:
                            rt = getattr(details, "reasoning_tokens", None)
                            if rt is not None:
                                usage_out["reasoning"] = int(rt)
                    # OpenRouter ships USD on the wire under usage.cost (some
                    # responses also expose total_cost). PromptPotter's
                    # dashboard prefers this over its rate table when present.
                    cost = getattr(u, "cost", None)
                    if cost is None:
                        cost = getattr(u, "total_cost", None)
                    if cost is not None:
                        usage_out["cost_usd"] = float(cost)
                usage_out["finish_reason"] = normalized_fr
                usage_out["max_tokens_requested"] = params.get("max_tokens", max_tokens)
                usage_out["model"] = model

            # Parse + (for schema mode) validate client-side, repairing in place.
            if output_format == "schema":
                try:
                    parsed = json.loads(content)
                except json.JSONDecodeError:
                    if repair_attempt < _STRUCTURED_REPAIR_ATTEMPTS:
                        repair_attempt += 1
                        _note_repair(node_name, repair_attempt, "response was not valid JSON", warnings)
                        _append_repair_turn(messages, content, "Response was not valid JSON.")
                        continue
                    raise HTTPException(
                        422,
                        {
                            "upstream_provider": provider,
                            "upstream_model": model,
                            "error_code": "json_parse_failed",
                            "node": node_name,
                        },
                    )
                schema_err = _schema_errors(parsed, schema) if schema is not None else ""
                if schema_err:
                    if repair_attempt < _STRUCTURED_REPAIR_ATTEMPTS:
                        repair_attempt += 1
                        _note_repair(node_name, repair_attempt, schema_err, warnings)
                        _append_repair_turn(messages, content, schema_err)
                        continue
                    raise HTTPException(
                        422,
                        {
                            "upstream_provider": provider,
                            "upstream_model": model,
                            "error_code": "schema_validation_failed",
                            "validation_errors": schema_err,
                            "node": node_name,
                        },
                    )
                return parsed
            if output_format == "json":
                return json.loads(content)
            return content

        except HTTPException:
            # Validation-exhaustion (422) and already-shaped upstream errors propagate
            # untouched — they are deliberate, not transport failures to retry/re-wrap.
            raise
        except asyncio.TimeoutError:
            if attempt == _RETRY_ATTEMPTS - 1:
                header = fmt_fields(
                    node_name or "llm",
                    "timeout",
                    f"{provider}:{model}",
                    ("attempt", f"{attempt + 1}/{_RETRY_ATTEMPTS}"),
                    ("timeout_s", _TIMEOUT),
                )
                logger.error("%s %s", TAG_LLM_ERR, header)
                raise HTTPException(503, "LLM request timeout")
            await asyncio.sleep(_RETRY_BACKOFF_BASE ** attempt)
            attempt += 1
        except Exception as e:
            status = getattr(e, "status_code", None)
            upstream = _format_api_error(e)
            err_code = _extract_error_code(e)
            if status == 429:
                # Forward the provider's Retry-After to the client (RFC 7231).
                # Server-side seconds-scale backoff is useless against Groq TPD
                # windows (multi-hour); the client decides whether to wait.
                # Surface provider/model both in the server log and the response
                # detail so the consumer (PromptPotter) sees which call hit the
                # cap, not just the bare 429.
                retry_after = _extract_retry_after(e)
                header = fmt_fields(
                    node_name or "llm",
                    f"HTTP 429 {err_code or 'rate_limit_exceeded'}",
                    f"{provider}:{model}",
                    ("retry_after", f"{retry_after}s" if retry_after is not None else None),
                )
                logger.warning(
                    "%s %s\n%s",
                    TAG_LLM_ERR, header, continuation(upstream, "upstream"),
                )
                headers = {"Retry-After": str(retry_after)} if retry_after else None
                raise HTTPException(
                    429,
                    f"LLM rate limited (provider={provider}, model={model}): {upstream}",
                    headers=headers,
                )
            if status and 400 <= status < 500:
                if _is_token_limit_error(e) and max_tokens is not None:
                    _mt = params.get("max_tokens", max_tokens)
                    header = fmt_fields(
                        node_name or "llm",
                        "token limit · retrying without max_tokens",
                        ("max_tokens", _mt),
                    )
                    logger.warning("%s %s", TAG_LLM_ERR, header)
                    if warnings is not None:
                        warnings.append(f"Token limit error (max_tokens={_mt}) — retried without limit")
                    params.pop("max_tokens", None)
                    max_tokens = None
                    continue
                # Upstream 4xx is the caller's fault — propagate as 4xx, not
                # 502. 502 Bad Gateway implies the upstream is broken, which
                # mis-signals a wire-format error to optimizers like
                # PromptPotter that treat 5xx as transient (and burn retries).
                # The detail dict carries the upstream summary so the consumer
                # can render "temperature: Invalid input: expected number..."
                # to the operator without scraping our log file.
                if status == 404:
                    phrase = "model_not_found"
                elif status == 401:
                    phrase = "auth_failed"
                else:
                    phrase = err_code or "client_error"
                header = fmt_fields(
                    node_name or "llm",
                    f"HTTP {status} {phrase}",
                    f"{provider}:{model}",
                )
                logger.error(
                    "%s %s\n%s",
                    TAG_LLM_ERR, header, continuation(upstream, "upstream"),
                )
                raise HTTPException(
                    status,
                    {
                        "upstream_status": status,
                        "upstream_provider": provider,
                        "upstream_model": model,
                        "upstream_message": upstream,
                        "error_code": err_code or phrase,
                    },
                )
            if attempt == _RETRY_ATTEMPTS - 1:
                header = fmt_fields(
                    node_name or "llm",
                    f"HTTP {status} {err_code or 'upstream_error'}" if status else "upstream_error",
                    f"{provider}:{model}",
                    ("attempt", f"{attempt + 1}/{_RETRY_ATTEMPTS}"),
                )
                logger.error(
                    "%s %s\n%s",
                    TAG_LLM_ERR, header, continuation(upstream, "upstream"),
                )
                raise HTTPException(503, f"LLM error: {upstream}")
            await asyncio.sleep(_RETRY_BACKOFF_BASE ** attempt)
            attempt += 1
