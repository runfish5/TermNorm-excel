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
import weakref
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any, Literal

from fastapi import HTTPException

from config.pipeline_config import get_llm_defaults
from core.log_format import (
    TAG_LLM,
    TAG_LLM_ERR,
    continuation,
    fmt_fields,
)

logger = logging.getLogger(__name__)

_llm_cfg = get_llm_defaults()

# Loop / budget knobs — non-provider; sourced from pipeline.json llm_defaults. Required, not
# defaulted: pipeline.json is the complete declaration of every tunable (no shadow defaults that
# could silently drift from config), so a missing key is a config error, not a fallback.
# One provider request's deadline grows with the reply it may generate (`_request_timeout`): a
# fixed deadline under a long `max_tokens` cuts the same request, billed, on every send.
_TIMEOUT_FLOOR_S = _llm_cfg["timeout_floor_s"]
_TIMEOUT_MIN_TOKENS_PER_S = _llm_cfg["timeout_min_tokens_per_s"]
# Every provider request one llm_call may send. Transport retries and schema repairs draw on this
# ONE budget, so it is each LLM node's served ``spend_bound.attempts`` whatever the node's mode.
_MAX_ATTEMPTS = _llm_cfg["max_attempts"]
_RETRY_BACKOFF_BASE = _llm_cfg["retry_backoff_base"]
_SEED = _llm_cfg["seed"]
_LOGPROBS = _llm_cfg["logprobs"]
# Schema-mode self-repair budget. On a parse/validation failure llm_call re-prompts the model with
# the validation errors, up to this many times and never past _MAX_ATTEMPTS, before raising 422.
_STRUCTURED_REPAIR_ATTEMPTS = _llm_cfg["structured_repair_attempts"]
# Head-cap on the reasoning trace surfaced through usage_out. Reasoning models
# (gpt-oss et al.) put their chain-of-thought on message.reasoning, not content;
# PromptPotter's critique tier reads it to diagnose per-sample failures.
_REASONING_TRACE_CAP = _llm_cfg["reasoning_trace_cap"]
# Structured-output mode. "native" (default) sends a provider-native ``response_format``
# (``json_schema`` when a schema is supplied, else ``json_object``) so capable models are
# CONSTRAINED to emit valid JSON. "prompt_repair" sends no ``response_format`` and relies
# only on the client-side parse/validate/repair loop — kept inactive for rare experiments
# with models that lack reliable native structured-output. Overridable per call via
# ``llm_call(structured_output_mode=...)`` (sourced from a node's config).
_STRUCTURED_OUTPUT_MODE = _llm_cfg["structured_output_mode"]

# Provider stop reasons, normalized so PromptPotter's classifier sees stable values.
_ANTHROPIC_FINISH = {
    "end_turn": "stop",
    "stop_sequence": "stop",
    "max_tokens": "length",
    "tool_use": "tool_use",
}
_OPENAI_FINISH = {"tool_calls": "tool_use"}


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

# One client per (provider, key) on each event loop. Building one loads the CA bundle
# synchronously — ~0.4 s on Windows — so a client per call ran every concurrent /matches
# request's setup one after another on the single worker's loop, capping the server near two
# requests in flight however many the caller sent. Keyed by loop because a client's
# connection pool belongs to the loop it first ran on.
_CLIENTS: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, dict[tuple[str, str], Any]] = (
    weakref.WeakKeyDictionary()
)


def _client(provider: str, api_key: str) -> Any:
    # max_retries=0 on both SDKs: a retry inside the SDK is a billed request llm_call never sees,
    # so every resend goes through llm_call's own loop, where it counts against _MAX_ATTEMPTS.
    clients = _CLIENTS.setdefault(asyncio.get_running_loop(), {})
    if (provider, api_key) not in clients:
        if provider == "anthropic":
            import anthropic

            clients[provider, api_key] = anthropic.AsyncAnthropic(api_key=api_key, max_retries=0)
        else:
            from openai import AsyncOpenAI

            base_url = _OPENAI_COMPAT_SPECS[provider].base_url
            clients[provider, api_key] = AsyncOpenAI(
                api_key=api_key, max_retries=0, **({"base_url": base_url} if base_url else {})
            )
    return clients[provider, api_key]


def _sdk_errors(provider: str) -> tuple[type[Exception], type[Exception]]:
    """(connection error, timeout error) of the SDK serving ``provider``. In both SDKs the
    timeout subclasses the connection error."""
    if provider == "anthropic":
        import anthropic as sdk
    else:
        import openai as sdk
    return sdk.APIConnectionError, sdk.APITimeoutError


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


def spend_limits(cfg: dict) -> dict:
    """The per-call spend caps ``llm_call`` enforces, read from one resolved LLM node config.

    Every call site passes ``**spend_limits(cfg)`` and :func:`llm_spend_bound` reads through
    here too, so what ``GET /pipeline`` serves is what ``/matches`` enforces.
    """
    return {
        "max_tokens": cfg["max_tokens"],
        "input_bytes": cfg["input_bytes"],
        "max_price": cfg["max_price"],
    }


def llm_spend_bound(cfg: dict) -> dict:
    """The most one run of an LLM node can bill: ``attempts`` provider requests, each carrying
    at most ``input_bytes`` of prompt text and generating at most ``max_tokens``."""
    limits = spend_limits(cfg)
    return {
        "kind": "llm",
        "attempts": _MAX_ATTEMPTS,
        "input_bytes": limits["input_bytes"],
        "max_tokens": limits["max_tokens"],
    }


def _is_token_limit_error(e: Exception) -> bool:
    """Detect a completion that ran out of token budget.

    The provider reports this two ways: plainly ("max completion tokens" in the
    error message), or — under Groq's native ``json_schema`` constrained decoding
    — as a ``json_validate_failed`` whose ``failed_generation`` reads "max
    completion tokens reached before generating a valid document". The second is a
    budget failure wearing a conformance label. Both are reported as
    ``finish_reason=length``; neither is re-driven, since only a bigger cap could help.
    """
    body = getattr(e, "body", None)
    if isinstance(body, dict):
        error = body.get("error", {})
        if isinstance(error, dict):
            if "max completion tokens" in str(error.get("message", "")):
                return True
            if "max completion tokens" in str(error.get("failed_generation", "")):
                return True
    return "max completion tokens" in str(e)


def _retryable(e: Exception, provider: str) -> bool:
    """A failed request worth sending again: a 5xx, or a connection that never got a response.

    A read timeout is not one — the provider may have generated, and billed, before it — so it
    is terminal. A 429 propagates with its Retry-After instead: rate windows run to hours, so
    the caller decides whether to wait. Every resend still counts against _MAX_ATTEMPTS.
    """
    status = getattr(e, "status_code", None)
    if status is not None:
        return status >= 500
    connection_error, timeout_error = _sdk_errors(provider)
    return isinstance(e, connection_error) and not isinstance(e, timeout_error)


def _left_unreported(e: Exception, provider: str) -> bool:
    """A failed request that may have reached a model and came back with no usage: a 5xx / 408,
    or a connection that broke after the request left. Reported as ``unreported_attempts``, so
    PromptPotter holds exactly these at their bound and reads every other attempt off the sums.
    A timeout is not one: it marks the whole call ``unreported``."""
    status = getattr(e, "status_code", None)
    if status is not None:
        return status >= 500 or status == 408
    connection_error, timeout_error = _sdk_errors(provider)
    if not isinstance(e, connection_error) or isinstance(e, timeout_error):
        return False
    import httpx

    return not isinstance(e.__cause__, (httpx.ConnectError, httpx.ConnectTimeout))


def _input_bytes(messages: list[dict], params: dict) -> int:
    """UTF-8 bytes of one request's prompt text: every message, plus the response schema when
    it is sent natively — the provider tokenizes that as prompt too."""
    size = sum(len(str(m["content"]).encode("utf-8")) for m in messages)
    if "response_format" in params:
        size += len(json.dumps(params["response_format"]).encode("utf-8"))
    return size


def _accrue_usage(usage: dict, response: Any, provider: str) -> None:
    """Add one response's provider-reported usage to the call's running totals.

    ``reasoning`` (OpenAI-compat) and ``cost_usd`` (OpenRouter ships USD as ``usage.cost``,
    some responses as ``total_cost``) appear only once a provider reports them.
    """
    u = getattr(response, "usage", None)
    if u is None:
        return
    if provider == "anthropic":
        cache_read = getattr(u, "cache_read_input_tokens", None)
        tokens = {
            "input": (getattr(u, "input_tokens", 0) or 0) + (cache_read or 0),
            "output": getattr(u, "output_tokens", 0),
        }
    else:
        tokens = {"input": getattr(u, "prompt_tokens", 0), "output": getattr(u, "completion_tokens", 0)}
        reasoning = getattr(getattr(u, "completion_tokens_details", None), "reasoning_tokens", None)
        if reasoning is not None:
            tokens["reasoning"] = reasoning
        cache_read = getattr(getattr(u, "prompt_tokens_details", None), "cached_tokens", None)
    # Absent is "not reported", never 0: PromptPotter renders the two differently.
    if cache_read is not None:
        tokens["cache_read"] = cache_read
    cost = getattr(u, "cost", None)
    if cost is None:
        cost = getattr(u, "total_cost", None)
    if cost is not None:
        usage["cost_usd"] = usage.get("cost_usd", 0.0) + float(cost)
    for key, value in tokens.items():
        usage[key] = usage.get(key, 0) + int(value or 0)


# JSON Schema type name -> Python predicate. ``bool`` is excluded from
# number/integer because JSON Schema treats booleans as a distinct type.
_TYPE_CHECKS: dict[str, Callable[[object], bool]] = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def _iter_schema_errors(instance: object, schema: dict, path: list) -> Iterator[tuple[list, str]]:
    """Walk ``instance`` against the JSON-Schema subset we actually emit.

    Supported keywords: ``type`` (single or union), ``required``, ``properties``,
    ``items`` (single sub-schema applied to every element), ``enum``. Anything
    else is ignored — we control the schemas, so this stays a closed set.
    """
    expected = schema.get("type")
    if expected is not None:
        names = expected if isinstance(expected, list) else [expected]
        if not any(_TYPE_CHECKS.get(n, lambda _v: True)(instance) for n in names):
            yield path, f"expected type {' | '.join(names)}, got {type(instance).__name__}"
            return  # type mismatch makes deeper checks meaningless

    enum = schema.get("enum")
    if enum is not None and instance not in enum:
        yield path, f"value {instance!r} is not one of {enum}"

    if isinstance(instance, dict):
        for key in schema.get("required", []):
            if key not in instance:
                yield path + [key], "required property is missing"
        for key, sub in schema.get("properties", {}).items():
            if key in instance:
                yield from _iter_schema_errors(instance[key], sub, path + [key])

    if isinstance(instance, list):
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for i, element in enumerate(instance):
                yield from _iter_schema_errors(element, item_schema, path + [i])


def _schema_errors(instance: object, schema: dict) -> str:
    """Return a compact bullet list of schema-validation errors, or '' if valid."""
    errors = sorted(_iter_schema_errors(instance, schema, []), key=lambda e: [str(p) for p in e[0]])
    if not errors:
        return ""
    lines = []
    for loc_path, message in errors[:8]:
        loc = "/".join(str(p) for p in loc_path) or "(root)"
        lines.append(f"- {loc}: {message}")
    return "\n".join(lines)


def _strictify(schema: dict) -> dict:
    """Deep-copy ``schema`` tightened for provider-native ``json_schema`` strict mode.

    Every object gets ``additionalProperties: false`` and a ``required`` listing all its
    declared properties (OpenAI's strict contract; harmless on Groq/OpenRouter). Recurses
    into ``properties`` and array ``items``. Operates over the same closed JSON-Schema
    subset we emit (object/array/string/number/...), so unknown keywords pass through.
    """
    if not isinstance(schema, dict):
        return schema
    out = dict(schema)
    t = out.get("type")
    types = t if isinstance(t, list) else [t]
    props = out.get("properties")
    if "object" in types or isinstance(props, dict):
        if isinstance(props, dict):
            out["properties"] = {k: _strictify(v) for k, v in props.items()}
            out["required"] = list(props.keys())
        out["additionalProperties"] = False
    items = out.get("items")
    if isinstance(items, dict):
        out["items"] = _strictify(items)
    return out


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


def _request_timeout(max_tokens: int) -> float:
    """Seconds one provider request may take: ``max_tokens`` at the slowest throughput accepted."""
    return max(_TIMEOUT_FLOOR_S, max_tokens / _TIMEOUT_MIN_TOKENS_PER_S)


def _send_error(
    e: Exception,
    provider: str,
    model: str,
    node_name: str | None,
    attempt: int,
    usage: dict,
    timeout_s: float,
) -> HTTPException:
    """Log a provider request that will not be sent again and shape the HTTPException for it."""
    node = node_name or "llm"
    if isinstance(e, (asyncio.TimeoutError, _sdk_errors(provider)[1])):
        # The provider may have generated, and billed, a reply nobody received, so this node's
        # usage is unknown; and the same request meets the same deadline again.
        usage["unreported"] = True
        header = fmt_fields(
            node,
            "timeout",
            f"{provider}:{model}",
            ("attempt", f"{attempt}/{_MAX_ATTEMPTS}"),
            ("timeout_s", f"{timeout_s:.0f}"),
        )
        logger.error("%s %s", TAG_LLM_ERR, header)
        return HTTPException(
            504,
            {
                "error_code": "llm_timeout",
                "retryable": False,
                "message": f"{node}: no reply from {provider}:{model} within {timeout_s:.0f}s",
                "upstream_provider": provider,
                "upstream_model": model,
                "timeout_s": timeout_s,
                "node": node_name,
            },
        )
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
            node,
            f"HTTP 429 {err_code or 'rate_limit_exceeded'}",
            f"{provider}:{model}",
            ("retry_after", f"{retry_after}s" if retry_after is not None else None),
        )
        logger.warning("%s %s\n%s", TAG_LLM_ERR, header, continuation(upstream, "upstream"))
        headers = {"Retry-After": str(retry_after)} if retry_after else None
        return HTTPException(
            429,
            f"LLM rate limited (provider={provider}, model={model}): {upstream}",
            headers=headers,
        )
    if status and 400 <= status < 500:
        if _is_token_limit_error(e):
            usage["finish_reason"] = "length"
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
        header = fmt_fields(node, f"HTTP {status} {phrase}", f"{provider}:{model}")
        logger.error("%s %s\n%s", TAG_LLM_ERR, header, continuation(upstream, "upstream"))
        return HTTPException(
            status,
            {
                "upstream_status": status,
                "upstream_provider": provider,
                "upstream_model": model,
                "upstream_message": upstream,
                "error_code": err_code or phrase,
            },
        )
    header = fmt_fields(
        node,
        f"HTTP {status} {err_code or 'upstream_error'}" if status else "upstream_error",
        f"{provider}:{model}",
        ("attempt", f"{attempt}/{_MAX_ATTEMPTS}"),
    )
    logger.error("%s %s\n%s", TAG_LLM_ERR, header, continuation(upstream, "upstream"))
    return HTTPException(503, f"LLM error: {upstream}")


async def llm_call(
    messages: list[dict[str, str]],
    *,
    provider: str,
    model: str,
    max_tokens: int,
    input_bytes: int,
    max_price: dict | None,
    system: str | None = None,
    stop_sequences: list[str] | None = None,
    temperature: float = 0.7,
    output_format: Literal["text", "json", "schema"] = "text",
    schema: dict | None = None,
    structured_output_mode: Literal["native", "prompt_repair"] | None = None,
    seed: int | None = None,
    logprobs: int | None = None,
    top_p: float | None = None,
    reasoning_effort: Literal["none", "default", "low", "medium", "high"] | None = None,
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
        max_tokens, input_bytes, max_price: the node's spend caps, passed as
            ``**spend_limits(cfg)``. ``max_tokens`` rides every request and nothing
            raises it; a request whose prompt text exceeds ``input_bytes`` UTF-8 bytes
            is refused (413) before it is sent, repair resends included;
            ``max_price`` (USD per million tokens) keeps OpenRouter off pricier upstreams.
        usage_out: Optional dict the caller supplies to receive usage summed over
            EVERY provider request this call sent. It fills as requests go out, so
            it is complete when the call raises too: ``attempts`` (requests sent),
            ``input``/``output`` and, once reported, ``reasoning``/``cost_usd``;
            plus the last response's ``finish_reason``/``reasoning_text``/``served_by``,
            and ``max_tokens_requested``/``model``; ``unreported`` once a request
            timed out, whose usage nobody learned; ``unreported_attempts`` counting the
            failed requests that may have billed and reported no usage.
    """
    is_openai_compat = provider in _OPENAI_COMPAT_SPECS
    if not is_openai_compat and provider != "anthropic":
        raise ValueError(
            f"Unknown provider: {provider!r}. Valid: {', '.join(_VALID_PROVIDERS)}."
        )
    for cap_name, cap in (("max_tokens", max_tokens), ("input_bytes", input_bytes)):
        if isinstance(cap, bool) or not isinstance(cap, int) or cap < 1:
            raise HTTPException(
                400,
                {
                    "error_code": "invalid_spend_cap",
                    "message": f"{node_name or 'llm'}: {cap_name} must be a positive integer, got {cap!r}",
                    "node": node_name,
                },
            )
    usage = usage_out if usage_out is not None else {}

    # Per-LLM-node start line — one chokepoint, every node inherits.
    # Emits "[LLM ] {node} · {provider}:{model} · reasoning=X" so the operator
    # sees model + reasoning on every call. Input chars are already on the
    # [REQ ] line (for /matches calls); duplicating here was redundant.
    if node_name is not None:
        # DEBUG, not INFO: provider/model/reasoning are echoed once per config
        # change on the [CFG ] line, so a per-call dispatch echo is redundant on
        # the happy path. Failures still surface via [LLM!] at warning/error.
        body = fmt_fields(
            node_name,
            f"{provider}:{model}",
            ("reasoning", reasoning_effort),
        )
        logger.debug(f"{TAG_LLM} {body}")

    if system:
        messages = [{"role": "system", "content": system}] + messages

    params: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if stop_sequences:
        params["stop"] = stop_sequences

    # Reproducibility and diagnostics (OpenAI-compatible providers only)
    effective_seed = seed if seed is not None else _SEED
    if effective_seed is not None and is_openai_compat:
        params["seed"] = effective_seed
    # A sampling axis the caller may search; accepted here so it does not evaporate between a
    # node config that declares it and a request that never carried it.
    if top_p is not None:
        params["top_p"] = top_p
    effective_logprobs = logprobs if logprobs is not None else _LOGPROBS
    if effective_logprobs is not None and is_openai_compat:
        params["logprobs"] = True
        params["top_logprobs"] = effective_logprobs
    # "default" is the caller's rung for "send no effort at all"; every other value, "none"
    # included, is one the provider defines — "none" means reasoning genuinely OFF. Sending
    # "default" as a literal was the bug: on a model that reasons by default it read as a cap
    # that existed and did nothing, which is how a caller paid for 92.8% reasoning tokens while
    # its config said it had asked for less.
    if reasoning_effort not in (None, "default") and is_openai_compat:
        params["reasoning_effort"] = reasoning_effort
    # OpenRouter routing: only upstreams priced under the cap, and only ones that honor every
    # parameter sent — one that silently dropped max_tokens would void the output bound.
    if max_price is not None and provider == "openrouter":
        params["extra_body"] = {"provider": {"max_price": max_price, "require_parameters": True}}

    # Structured output. In "native" mode (default) we send a provider-native
    # ``response_format`` so capable models are CONSTRAINED to valid JSON — the
    # client-side parse/validate/repair loop below stays on as a universal safety net,
    # so native is strictly more robust than prompt-only. ``json_schema`` (schema
    # supplied) needs no caveat; bare ``json_object`` is openai-compat-only and 400s
    # unless the literal word "json" appears in the messages. "prompt_repair" mode
    # sends NO ``response_format`` and leans on the repair loop alone — kept inactive
    # for rare models without reliable native structured output (opt in per node via
    # ``config.structured_output_mode``). Anthropic has no ``response_format``; it stays
    # prompt-instructed + repair regardless of mode.
    so_mode = structured_output_mode or _STRUCTURED_OUTPUT_MODE
    if so_mode == "native" and is_openai_compat and output_format in ("json", "schema"):
        if schema is not None:
            params["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": (node_name or "structured_output").replace(" ", "_")[:64],
                    "schema": _strictify(schema),
                    "strict": True,
                },
            }
        else:
            params["response_format"] = {"type": "json_object"}

    env = _OPENAI_COMPAT_SPECS[provider].api_key_env if is_openai_compat else "ANTHROPIC_API_KEY"
    api_key = os.getenv(env)
    if not api_key:
        raise ValueError(f"API key not found for {provider}")
    client = _client(provider, api_key)

    # One loop, one budget: each pass sends one request and counts it, whether it is the first
    # send, a resend after a 5xx / unsent connection, or a schema-repair re-prompt.
    attempt = 0
    repairs = 0
    timeout_s = _request_timeout(max_tokens)
    while True:
        sent_bytes = _input_bytes(messages, params)
        if sent_bytes > input_bytes:
            header = fmt_fields(
                node_name or "llm",
                "input over cap · refused",
                ("bytes", sent_bytes),
                ("cap", input_bytes),
            )
            logger.error("%s %s", TAG_LLM_ERR, header)
            raise HTTPException(
                413,
                {
                    "error_code": "input_too_large",
                    "message": (
                        f"{node_name or 'llm'}: request input is {sent_bytes} UTF-8 bytes, "
                        f"over the node's input_bytes cap of {input_bytes}"
                    ),
                    "input_bytes": sent_bytes,
                    "input_bytes_cap": input_bytes,
                    "node": node_name,
                },
            )
        attempt += 1
        usage["attempts"] = attempt
        usage["max_tokens_requested"] = max_tokens
        usage["model"] = model
        try:
            if provider == "anthropic":
                anthropic_params: dict = {
                    "model": model,
                    "messages": [m for m in messages if m["role"] != "system"],
                    "max_tokens": max_tokens,
                    "temperature": temperature,
                }
                if system:
                    anthropic_params["system"] = system
                if stop_sequences:
                    anthropic_params["stop_sequences"] = stop_sequences
                response = await asyncio.wait_for(
                    client.messages.create(**anthropic_params), timeout=timeout_s
                )
            else:
                response = await asyncio.wait_for(
                    client.chat.completions.create(**params), timeout=timeout_s
                )
        except Exception as e:
            if _left_unreported(e, provider):
                usage["unreported_attempts"] = usage.get("unreported_attempts", 0) + 1
            if attempt < _MAX_ATTEMPTS and _retryable(e, provider):
                header = fmt_fields(
                    node_name or "llm",
                    "upstream failure · resending",
                    f"{provider}:{model}",
                    ("attempt", f"{attempt}/{_MAX_ATTEMPTS}"),
                )
                logger.warning(
                    "%s %s\n%s", TAG_LLM_ERR, header, continuation(_format_api_error(e), "upstream")
                )
                await asyncio.sleep(_RETRY_BACKOFF_BASE ** (attempt - 1))
                continue
            raise _send_error(e, provider, model, node_name, attempt, usage, timeout_s) from e

        if provider == "anthropic":
            content = response.content[0].text if response.content else ""
            raw_fr = getattr(response, "stop_reason", None)
            usage["finish_reason"] = _ANTHROPIC_FINISH.get(raw_fr or "", raw_fr or "unknown")
            truncated = raw_fr == "max_tokens"
        else:
            # Some providers (notably reasoning models) ship a successful response with
            # ``message.content = None`` — coerce to "" so the contract stays ``str | dict``.
            content = (response.choices[0].message.content or "") if response.choices else ""
            raw_fr = response.choices[0].finish_reason if response.choices else None
            usage["finish_reason"] = _OPENAI_FINISH.get(raw_fr or "", raw_fr or "unknown")
            truncated = raw_fr == "length"
            if response.choices:
                reasoning = getattr(response.choices[0].message, "reasoning", None) or ""
                if reasoning:
                    usage["reasoning_text"] = reasoning[:_REASONING_TRACE_CAP]
                # Reasoning models (e.g. Groq gpt-oss-120b) can spend their entire output
                # budget on the hidden ``reasoning`` field and return ``content=""``. Emit a
                # neutral advisory and let raw response shape (finish_reason +
                # reasoning_tokens) flow through ``usage_out``; PromptPotter's classifier
                # decides whether this is fatal. The reasoning trace is internal monologue,
                # never substituted as the answer.
                if not content:
                    header = fmt_fields(
                        node_name or "llm",
                        "empty content",
                        ("finish_reason", raw_fr or "unknown"),
                        ("reasoning_chars", len(reasoning)),
                    )
                    logger.warning("%s %s", TAG_LLM_ERR, header)
                    if warnings is not None:
                        warnings.append(
                            f"content_empty: finish_reason={raw_fr or 'unknown'} "
                            f"reasoning_chars={len(reasoning)}"
                        )
        _accrue_usage(usage, response, provider)
        # WHICH host answered, where ``provider`` is a gateway routing onward (OpenRouter puts it
        # on the response root). Absent for a provider that is its own host.
        served = (getattr(response, "model_extra", None) or {}).get("provider")
        if served:
            usage["served_by"] = str(served)

        if output_format == "text":
            return content

        # Parse + validate client-side, repairing in place. ``json`` and ``schema`` share ONE
        # path — both parse-and-repair; ``schema`` (when a ``schema`` is supplied) additionally
        # checks structure.
        try:
            parsed = json.loads(content)
            error_code = "schema_validation_failed"
            problem = _schema_errors(parsed, schema) if schema is not None else ""
        except json.JSONDecodeError:
            error_code, problem = "json_parse_failed", "Response was not valid JSON."
        if not problem:
            return parsed
        # The model ANSWERED and was billed; the caller grades this as the configuration's miss and
        # prices it, so the spend rides the error in the success path's `step_tokens` shape.
        detail = {
            "upstream_provider": provider,
            "upstream_model": model,
            "error_code": error_code,
            "node": node_name,
            "step_tokens": {
                node_name or "llm": {k: v for k, v in usage.items() if k != "reasoning_text"}
            },
        }
        if truncated:
            # Cut off at max_tokens. A repair resend at the same cap would be cut off again and
            # the cap is never raised, so the truncation is the result.
            raise HTTPException(422, {**detail, "error_code": "output_truncated", "finish_reason": "length"})
        if repairs < _STRUCTURED_REPAIR_ATTEMPTS and attempt < _MAX_ATTEMPTS:
            repairs += 1
            _note_repair(node_name, repairs, problem, warnings)
            _append_repair_turn(messages, content, problem)
            continue
        if error_code == "schema_validation_failed":
            detail["validation_errors"] = problem
        raise HTTPException(422, detail)
