"""
Research Pipeline API - Session-based term matching
"""
import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, HTTPException, Request, Body

from research_and_rank.call_llm_for_ranking import find_top_matches
from research_and_rank.token_matcher import TokenLookupMatcher
from core.llm_providers import llm_call
from core.log_format import TAG_CFG, TAG_LOAD, TAG_PIPE, TAG_REQ, TAG_STEP, fmt_fields, fmt_list
from core import throughput
from core.pipeline_context import PipelineContext, StepResult, StepStatus, WarningKind
from services.match_database import get_db as get_match_database, get_cache_metadata, update as update_match_database
from utils.langfuse_logger import log_batch_start, log_batch_complete, log_pipeline
from utils.schema_registry import append_structure_directive
from config.pipeline_config import (
    get_node_config,
    get_pipeline_steps,
    validate_step_dependencies,
)
from api.responses import _ok
from api._step_logging import STEP_NODE_TYPE, log_run_summary, log_step_short
from api.pipeline_steps import STEP_REGISTRY, PRECOMPUTED_DESERIALIZERS, REQUIRES_SESSION
from api.response_builder import build_response

logger = logging.getLogger(__name__)

router = APIRouter()


# Module-level aliases for match database (used by callers that import from this module)
match_database = get_match_database()
cache_metadata = get_cache_metadata()

_node = get_node_config
_pipeline = get_pipeline_steps

# Threshold for accepting fuzzy corrections in direct prompt
ACCEPT_THRESHOLD = _node("direct_prompt")["accept_threshold"]

# direct_prompt's output shape — declared once, rendered into the prompt via the same
# append_structure_directive seam every other node uses (not a hand-written JSON block).
# `confidence`'s 0.0-1.0 range rides the instruction prose: format_string_from_schema inlines
# descriptions for string/enum fields, not numeric ones.
_DIRECT_PROMPT_SCHEMA = {
    "type": "object",
    "properties": {
        "output": {"type": "string", "description": "the processed/transformed result"},
        "confidence": {"type": "number", "description": "0.0-1.0"},
        "reasoning": {"type": "string", "description": "brief explanation of what you did"},
    },
}


def _update_session_usage(user_id, target=None):
    """Increment session query count and optionally track target usage."""
    if user_id not in user_sessions:
        return
    user_sessions[user_id]["query_count"] += 1
    if target:
        targets = user_sessions[user_id]["targets_used"]
        targets[target] = targets.get(target, 0) + 1


# Session storage - stores terms array and usage stats per user
# Structure: {user_id: {"terms": [...], "init_time": datetime, "query_count": int, "targets_used": {}}}
user_sessions = {}


@router.post("/sessions")
async def init_terms(request: Request, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Create session with terms array and tracking"""
    user_id = request.state.user_id
    terms = payload.get("terms", [])

    if not terms:
        raise HTTPException(
            status_code=400,
            detail="No terms provided - include terms array in request payload"
        )

    # Store terms in session with usage tracking
    user_sessions[user_id] = {
        "terms": terms,
        "init_time": datetime.now(timezone.utc),
        "query_count": 0,
        "targets_used": {}  # target → count
    }

    logger.info(f"[SESSION] User {user_id}: Initialized session with {len(terms)} terms")

    return _ok(
        message=f"Session initialized with {len(terms)} terms",
        data={"term_count": len(terms)}
    )


def _resolve_pipeline_params(
    payload: dict[str, Any],
    steps: list[str] | None = None,
) -> dict[str, dict[str, Any]]:
    """Resolve per-node config by per-key merge of caller overrides on defaults.

    Backend's ``pipeline.json::nodes.{name}.config`` is the source of truth.
    Caller's ``node_config[name]`` is a sparse override map — only the keys
    the caller wants to mutate. The two are merged per-key, override on top.

    Lets PromptPotter (and any client) send minimal overrides like
    ``{"llm_only": {"temperature": 0.7}}`` without restating every other key
    (provider, model, max_tokens, ...). New backend defaults flow through
    automatically.
    """
    ov = payload.get("node_config", {})
    active = set(steps or _pipeline("default"))
    resolved: dict[str, dict[str, Any]] = {}
    for node_name in active:
        merged = dict(_node(node_name))
        if node_name in ov:
            merged.update(ov[node_name])
        resolved[node_name] = merged
    return resolved


# Config echo is stateful by design. The effective LLM config (provider, model,
# reasoning, temperature, prompt size) is identical across a homogeneous batch,
# so echoing it on every request is pure noise that buries the per-request line.
# We print it once via [CFG ] and re-print only when the signature changes.
_last_cfg_sig: str | None = None
_LLM_NODE_TYPES = {"llm", "match-ranker", "enricher"}  # nodes that call an LLM

# Throughput heartbeat cadence — the [LOAD] line prints at most this often, so a
# busy batch gets a periodic utilization pulse without a line per request.
_LOAD_EVERY_S = 15.0
_last_load_emit = 0.0


def _cfg_line(node: str, cfg: dict) -> str:
    """One `[CFG ]` body: the effective LLM config for *node*, prompt as a size."""
    parts: list[str] = [node]
    prov, model = cfg.get("provider"), cfg.get("model")
    parts.append(f"{prov}:{model}" if prov and model else str(model or prov or "?"))
    if cfg.get("reasoning_effort"):
        parts.append(f"reasoning={cfg['reasoning_effort']}")
    if cfg.get("temperature") is not None:
        parts.append(f"temp={cfg['temperature']}")
    if cfg.get("max_tokens") is not None:
        parts.append(f"max={cfg['max_tokens']}")
    prompt = cfg.get("prompt")
    if isinstance(prompt, str) and prompt:
        parts.append(f"prompt={len(prompt)}c")
    return " · ".join(parts)




@router.post("/matches")
async def research_and_match(request: Request, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Normalize a term — dispatch through the step registry."""
    user_id = request.state.user_id
    query = payload.get("query", "")
    payload_steps = payload.get("steps")
    steps = payload_steps or _pipeline("default")
    trace_id = payload.get("trace_id")

    params = _resolve_pipeline_params(payload, steps=steps)
    precomputed = payload.get("precomputed") or {}

    # Session relaxation — only require a session for steps that need terms
    requires_session = bool(set(steps) & REQUIRES_SESSION)
    if requires_session:
        if user_id not in user_sessions:
            # Stable machine-readable code so a client (PromptPotter) can
            # auto-recover — re-POST /sessions + retry — instead of aborting.
            # The in-memory session is wiped on every backend restart/--reload,
            # so this fires constantly during backend development.
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "no_session",
                    "message": "No session found - initialize session first with POST /sessions",
                },
            )
        terms = user_sessions[user_id]["terms"]
    else:
        terms = []

    # Throughput heartbeat — record this request, then emit a throttled [LOAD]
    # line (1m/5m/15m req/min, load-average style) above the request group.
    global _last_cfg_sig, _last_load_emit
    throughput.record()
    _now = time.monotonic()
    if _now - _last_load_emit >= _LOAD_EVERY_S:
        logger.info(f"{TAG_LOAD} {throughput.format_load()}")
        _last_load_emit = _now

    # Config echo — once, on change. The effective LLM config is constant across
    # a batch; print it only when its signature moves (see _last_cfg_sig).
    cfg_lines = [
        _cfg_line(s, params.get(s, {}))
        for s in steps
        if STEP_NODE_TYPE.get(s) in _LLM_NODE_TYPES
    ]
    sig = " || ".join(cfg_lines)
    if cfg_lines and sig != _last_cfg_sig:
        for cl in cfg_lines:
            logger.info(f"{TAG_CFG} {cl}")
        _last_cfg_sig = sig

    # Per-request entry: path · steps · size · query preview. The query is
    # whitespace-collapsed — raw newlines would split the line mid-preview.
    # (The blank-line boundary between requests is a trailing newline on the
    # prior [RESP]; see log_run_summary.)
    steps_str = steps[0] if len(steps) == 1 else fmt_list(steps)
    overrides = list((payload.get("node_config") or {}).keys())
    extra_overrides = [o for o in overrides if o not in steps]
    query_oneline = " ".join(query.split())
    query_display = query_oneline if len(query_oneline) <= 40 else f"{query_oneline[:40]}…"
    body = fmt_fields(
        "/matches",
        steps_str,
        ("overrides", fmt_list(extra_overrides) if extra_overrides else None),
        ("terms", len(terms) if terms else None),
        ("precomputed", fmt_list(precomputed) if precomputed else None),
        f"{len(query)} chars",
        f'"{query_display}"',
    )
    logger.info(f"{TAG_REQ} {body}")

    # Validate step dependencies — warn if input_keys aren't satisfied
    # (precomputed outputs count as available upstream)
    _dep_violations = validate_step_dependencies(steps, pre_available=set(precomputed))
    if _dep_violations:
        logger.warning(
            "%s unsatisfied step dependencies · %s",
            TAG_REQ, _dep_violations,
        )

    ctx = PipelineContext(query, user_id, requested_steps=steps, params=params)

    # Seed session data into context — only when pipeline needs term matching
    if requires_session and terms:
        ctx.set_output("_session_terms", terms)
        token_matcher = TokenLookupMatcher(terms)
        ctx.set_output("_token_matcher", token_matcher)
        logger.debug(
            "%s token_matcher · unique=%d",
            TAG_REQ, len(token_matcher.deduplicated_terms),
        )

    # Pre-register precomputed outputs (per-node deserializers in PRECOMPUTED_DESERIALIZERS)
    for step_name, precomp_data in precomputed.items():
        deser = PRECOMPUTED_DESERIALIZERS.get(step_name)
        ctx.record_precomputed(step_name, deser(precomp_data) if deser else precomp_data)

    # Dispatch loop
    for step_name in steps:
        if step_name not in STEP_REGISTRY:
            logger.warning("%s unknown step %r · skipping", TAG_STEP, step_name)
            ctx.record_step(step_name, StepStatus.SKIPPED)
            continue

        # Skip if already precomputed
        if step_name in precomputed:
            continue

        cfg = params.get(step_name, {})
        try:
            result = await STEP_REGISTRY[step_name](query, cfg, ctx)
        except HTTPException:
            raise
        except Exception as exc:
            ctx.record_step(step_name, StepStatus.FAILED)
            ctx.add_warning(step_name, "step_error", f"{step_name} failed: {exc}", WarningKind.STRUCTURAL)
            result = StepResult(output=None, elapsed=0.0, status=StepStatus.FAILED)

        # Record step (step functions may also record internally for coupled steps)
        ctx.record_step(step_name, result.status, elapsed=result.elapsed)
        ctx.set_output(step_name, result.output)
        for w in result.warnings:
            ctx.add_warning(step_name, w.code, w.message, w.kind,
                            details=list(w.details) if w.details else None,
                            stats=dict(w.stats) if w.stats else None)

        # Short-form per-step log: only for non-terminal steps that actually
        # produced output. FAILED/SKIPPED steps surface in the [RESP] status
        # row; terminal steps flow through log_run_summary.
        if (
            not result.terminates
            and result.status not in (StepStatus.FAILED, StepStatus.SKIPPED)
            and step_name in STEP_NODE_TYPE
        ):
            log_step_short(ctx, step_name, STEP_NODE_TYPE[step_name], result)

        if result.terminates:
            break

    # One envelope for every terminal node (single-node llm_only, fuzzy-only, or
    # full ranker pipeline). training_record is None for the terminal-early
    # cases — nothing to persist against the session term library.
    training_record, api_response = build_response(ctx)
    log_run_summary(ctx, api_response)

    # Telemetry + match-DB persistence are blocking file I/O (a whole-DB
    # json.dump + langfuse file writes). The response is already built, so
    # offload them to a thread — otherwise they freeze the single worker's
    # event loop on every full-pipeline call, stalling concurrent /matches +
    # /status while PP fans out scoring.
    if training_record is not None:
        try:
            await asyncio.to_thread(
                log_pipeline, training_record, session_id=user_id, trace_id=trace_id
            )
        except Exception as e:
            logger.error(f"[LANGFUSE] Failed to log: {e}")

        await asyncio.to_thread(update_match_database, training_record)
        if requires_session:
            _update_session_usage(user_id, training_record["target"])

    return api_response


@router.post("/batches")
async def batch_start(
    request: Request,
    payload: dict[str, Any] = Body(...)
) -> dict[str, Any]:
    """
    Create a batch operation. Returns batch_id for linking items.

    Payload:
        method: "DirectPrompt" (required)
        user_prompt: User's instruction prompt (required)
        item_count: Number of items to process (required)
    """
    user_id = request.state.user_id
    method = payload.get("method", "DirectPrompt")
    user_prompt = payload.get("user_prompt", "")
    item_count = payload.get("item_count", 0)

    if not user_prompt:
        raise HTTPException(400, "user_prompt is required")
    if item_count < 1:
        raise HTTPException(400, "item_count must be >= 1")

    batch_id = log_batch_start(
        method=method,
        user_prompt=user_prompt,
        item_count=item_count,
        session_id=user_id,
    )

    logger.info(f"{TAG_PIPE} batch started {batch_id}: {method}, {item_count} items")

    return _ok(
        message=f"Batch started: {item_count} items",
        data={"batch_id": batch_id}
    )


@router.patch("/batches/{batch_id}")
async def batch_complete(
    request: Request,
    batch_id: str,
    payload: dict[str, Any] = Body(...)
) -> dict[str, Any]:
    """
    Complete a batch operation.

    Path params:
        batch_id: Batch ID from POST /batches
    Payload:
        success_count: Number of successful items (required)
        error_count: Number of failed items (default: 0)
        total_time_ms: Total batch time in milliseconds (default: 0)
    """
    success_count = payload.get("success_count", 0)
    error_count = payload.get("error_count", 0)
    total_time_ms = payload.get("total_time_ms", 0)

    log_batch_complete(
        batch_id=batch_id,
        success_count=success_count,
        error_count=error_count,
        total_time_ms=total_time_ms,
    )

    logger.info(f"{TAG_PIPE} batch completed {batch_id}: {success_count} success, {error_count} errors")

    return _ok(
        message=f"Batch completed: {success_count}/{success_count + error_count} successful",
        data={"batch_id": batch_id, "success_count": success_count, "error_count": error_count}
    )


@router.post("/prompts")
async def direct_prompt(
    request: Request,
    payload: dict[str, Any] = Body(...)
) -> dict[str, Any]:
    """
    Execute a direct LLM prompt with validation against session terms.

    Payload:
        query: Input text to process (required)
        user_prompt: User's instruction prompt (required)
        batch_id: Optional batch ID (for batch operations)
        current_output: Optional current output column value (provides context)
        project_context: Optional project-specific context string

    Returns:
        target: LLM output (processed/transformed value)
        confidence: 0.0-1.0 (set to 0 if output not in session terms)
        confidence_corrected: True if output was not in terms

    Flow:
    1. Build system prompt with project_context (if provided) + user_prompt
    2. Send to LLM with query and current_output (if provided)
    3. LLM returns output + confidence
    4. Validate: if output not in session terms → confidence = 0
    """
    user_id = request.state.user_id
    query = payload.get("query", "").strip()
    user_prompt = payload.get("user_prompt", "").strip()
    batch_id = payload.get("batch_id")  # Optional
    current_output = payload.get("current_output", "").strip()  # Current output column value
    project_context = payload.get("project_context", "").strip()  # Project-specific context

    logger.info(f"{TAG_PIPE} direct-prompt query='{query[:30]}', batch_id={batch_id}")

    if not query:
        raise HTTPException(400, "Query is required")
    if not user_prompt:
        raise HTTPException(400, "user_prompt is required")

    if user_id not in user_sessions:
        raise HTTPException(400, "No session found - initialize session first with POST /sessions")

    terms = user_sessions[user_id]["terms"]
    start_time = time.time()

    # Resolve direct_prompt node config through the same per-key merge every /matches node uses
    # (pipeline.json base + request node_config override) — not a hand-rolled per-field .get chain.
    dp = _resolve_pipeline_params(payload, steps=["direct_prompt"])["direct_prompt"]
    dp_provider = dp["provider"]
    dp_model = dp["model"]
    dp_temperature = dp["temperature"]
    dp_max_tokens = dp["max_tokens"]

    # Build system prompt for general LLM inference
    context_sections = []
    if project_context:
        context_sections.append(f"PROJECT CONTEXT:\n{project_context}")
    context_sections.append(f"USER INSTRUCTIONS:\n{user_prompt}")
    if current_output:
        context_sections.append(f"Current output value: {current_output}")

    system_prompt = append_structure_directive(
        "You are a helpful assistant that processes text according to user instructions.\n\n"
        f"{chr(10).join(context_sections)}\n\n"
        "For the given input, apply the user's instructions. `confidence` is 0.0-1.0.",
        _DIRECT_PROMPT_SCHEMA,
        suffix="Return ONLY valid JSON.",
    )

    # Build user message
    user_content = f"Input: {query}"
    if current_output:
        user_content += f"\nCurrent output: {current_output}"

    # Single LLM call
    try:
        response = await llm_call(
            messages=[{"role": "user", "content": user_content}],
            provider=dp_provider,
            model=dp_model,
            system=system_prompt,
            output_format="json",
            temperature=dp_temperature,
            max_tokens=dp_max_tokens,
        )

        # A response that omits `output` is a malformed result, not a confident answer — leave
        # target empty so it flows into the needs_user_selection path below (fuzzy score 0),
        # rather than writing the raw input query back as if the model had chosen it.
        # A present output with no confidence is the model declining to assert one — record 0.0
        # (no-confidence), never a fabricated midpoint. The needs_user_selection path below also
        # lands on 0.0, so an unscored result stays consistent either way.
        target = response.get("output", "")
        confidence = float(response.get("confidence", 0.0))
        reasoning = response.get("reasoning", "")

    except HTTPException:
        # llm_call already raised the standardized envelope (stable code, Retry-After on 429);
        # re-wrapping it into a 200 body would hide the failure — the frontend reads HTTP 200 as
        # success regardless of a status:"error" field.
        raise
    except Exception as e:
        logger.error(f"{TAG_PIPE} direct-prompt unexpected error: {e}")
        raise HTTPException(500, f"Direct prompt failed: {e}")

    total_time = round(time.time() - start_time, 2)

    # VALIDATION: Fuzzy match LLM output against session terms
    # Get top 10 closest matches and decide: accept, correct, or return candidates
    fuzzy_corrected = False
    needs_user_selection = False
    candidates = []
    fuzzy_score = 0.0
    original_target = None

    top_matches = find_top_matches(target, terms, n=dp["correction_top_n"])
    best_match, best_score = top_matches[0] if top_matches else (None, 0)
    fuzzy_score = best_score

    if best_score >= ACCEPT_THRESHOLD:
        if best_match != target:
            original_target = target
            target = best_match
            fuzzy_corrected = True
    else:
        needs_user_selection = True
        candidates = [{"candidate": c, "score": round(s, 3)} for c, s in top_matches]
        confidence = 0.0

    # Build training record (full dict, no conditional updates)
    training_record = {
        "source": query, "target": target, "method": "DirectPrompt",
        "confidence": confidence, "reasoning": reasoning,
        "llm_provider": dp_provider, "direct_prompt_model": dp_model,
        "total_time": total_time,
        "fuzzy_score": fuzzy_score, "fuzzy_corrected": fuzzy_corrected,
        "original_target": original_target, "needs_user_selection": needs_user_selection,
        "candidates": candidates,
    }

    try:
        log_pipeline(training_record, session_id=user_id, batch_id=batch_id, user_prompt=user_prompt)
    except Exception as e:
        logger.error(f"[LANGFUSE] Failed to log: {e}")

    if not needs_user_selection:
        update_match_database(training_record)
    _update_session_usage(user_id, target if not needs_user_selection else None)

    logger.info(f"{TAG_PIPE} direct-prompt {query[:30]}... -> {target[:30]} ({confidence:.0%}) in {total_time}s")

    return _ok(
        message="Direct prompt completed",
        data={
            "target": target, "confidence": confidence, "reasoning": reasoning,
            "total_time": total_time, "fuzzy_score": fuzzy_score,
            "fuzzy_corrected": fuzzy_corrected, "original_target": original_target,
            "needs_user_selection": needs_user_selection, "candidates": candidates,
        }
    )


