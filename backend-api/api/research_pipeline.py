"""
Research Pipeline API - Session-based term matching
"""
import json
import logging
import time
from datetime import datetime
from typing import Callable, Any
from fastapi import APIRouter, HTTPException, Request, Body

from research_and_rank.web_generate_entity_profile import web_generate_entity_profile
from research_and_rank.call_llm_for_ranking import call_llm_for_ranking, find_top_matches
from research_and_rank.fuzzy_matching import fuzzy_match_terms
from research_and_rank.token_matcher import TokenLookupMatcher
from core.llm_providers import llm_call
from core.log_format import TAG_REQ, TAG_STEP, fmt_fields, fmt_list
from core.pipeline_context import PipelineContext, StepResult, StepStatus, StepWarning
import utils.utils as utils
from utils.utils import RED, YELLOW, GREEN, WHITE, BRIGHT_RED, RESET
from services.match_database import get_db as get_match_database, get_cache_metadata, update as update_match_database
from utils.langfuse_logger import (
    log_batch_start, log_batch_complete, log_pipeline,
    log_cache_match, log_fuzzy_match, log_user_correction
)
from utils.schema_registry import get_schema_registry
from config.settings import settings
from config.pipeline_config import (
    get_node_config,
    get_pipeline_steps,
    get_session_required_steps,
    validate_step_dependencies,
)

logger = logging.getLogger(__name__)

from api.responses import _ok
from api._step_logging import STEP_NODE_TYPE, log_run_summary, log_step_short

router = APIRouter()

# Load entity schema from registry (versioned, pinned to pipeline.json config)
_schema_registry = get_schema_registry()
_ep_schema_cfg = get_node_config("entity_profiling")
ENTITY_SCHEMA = _schema_registry.get_schema(
    _ep_schema_cfg["schema_family"],
    _ep_schema_cfg.get("schema_version"),
)

# Module-level aliases for match database (used by callers that import from this module)
match_database = get_match_database()
cache_metadata = get_cache_metadata()

_node = get_node_config
_pipeline = get_pipeline_steps

# Threshold for accepting fuzzy corrections in direct prompt
ACCEPT_THRESHOLD = _node("direct_prompt")["accept_threshold"]


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
        "init_time": datetime.utcnow(),
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
    """Merge node_config overrides with pipeline.json defaults per node.

    Returns nested dict: ``{node_name: {param: value, ...}, ...}``.
    Only active nodes (in *steps*) are included.  Callers receive their
    node's native config keys — no prefixing.
    """
    ov = payload.get("node_config", {})
    active = set(steps or _pipeline("default"))
    resolved: dict[str, dict[str, Any]] = {}
    for node_name in active:
        defaults = _node(node_name)
        overrides = ov.get(node_name, {})
        resolved[node_name] = {**defaults, **overrides}
    return resolved


def _run_fuzzy_step(query: str, terms: list[str], fm_cfg: dict) -> tuple:
    """Step 0: Fuzzy matching. Returns (results, elapsed_time)."""
    logger.info(RED + "[PIPELINE] Step 0: Fuzzy matching" + RESET)
    t0 = time.time()
    results = fuzzy_match_terms(
        query, terms, threshold=fm_cfg["threshold"], scorer=fm_cfg["scorer"], limit=fm_cfg["limit"]
    )
    elapsed = round(time.time() - t0, 3)
    logger.info(f"[PIPELINE] Fuzzy: {len(results)} matches in {elapsed}s")
    return results, elapsed


async def _run_research_step(query: str, steps: list[str], ws_cfg: dict, ep_cfg: dict, llm_warnings: list[str] | None = None, scraped_content: list | None = None, usage_out: dict | None = None) -> tuple:
    """Step 1: Web search + entity profiling.
    Returns (entity_profile, profile_debug, ep_time, ws_time).
    Times are None when the step was skipped.

    When *scraped_content* is provided, web scraping is skipped and the
    precomputed content is passed directly to entity profiling. When
    *usage_out* is provided, it is populated with the LLM call's token
    usage (``{"input", "output"}``).
    """
    run_web_search = "web_search" in steps
    run_entity_profiling = "entity_profiling" in steps

    if not run_entity_profiling:
        logger.info(WHITE + "[PIPELINE] Step 1: Skipping entity profiling" + RESET)
        profile_debug = {"inputs": {"scraped_sources": {"status": "skipped", "note": "Skipped by pipeline steps"}}}
        return [], profile_debug, None, None

    if scraped_content is not None:
        logger.info(RED + "[PIPELINE] Step 1: Researching (precomputed web content)" + RESET)
    else:
        logger.info(RED + "[PIPELINE] Step 1: Researching" + (" (LLM knowledge only)" if not run_web_search else "") + RESET)
    entity_profile, profile_debug = await web_generate_entity_profile(
        query,
        ws_cfg=ws_cfg,
        ep_cfg=ep_cfg,
        schema=ENTITY_SCHEMA,
        skip_search=not run_web_search,
        warnings=llm_warnings,
        scraped_content=scraped_content,
        usage_out=usage_out,
    )
    logger.debug("[PIPELINE] Entity profile: %s", entity_profile)
    ep_time = profile_debug.get("llm_elapsed")
    ws_time = profile_debug.get("web_search_elapsed")
    return entity_profile, profile_debug, ep_time, ws_time


def _run_token_step(query: str, entity_profile: list, token_matcher: "TokenLookupMatcher") -> tuple:
    """Step 2: Token matching. Returns (candidate_results, elapsed_time)."""
    logger.info(YELLOW + "[PIPELINE] Step 2: Matching candidates" + RESET)
    search_terms = [word for s in [query] + utils.flatten_strings(entity_profile) for word in s.split()]
    unique_search_terms = list(set(search_terms))

    logger.debug(f"[PIPELINE] {len(unique_search_terms)} profile terms (from {len(search_terms)}): {', '.join(unique_search_terms[:20])}{'...' if len(unique_search_terms) > 20 else ''}")

    t0 = time.time()
    candidate_results = token_matcher.match(unique_search_terms)
    elapsed = round(time.time() - t0, 3)

    n = len(candidate_results)
    if n:
        top_name, top_score = candidate_results[0]
        bot_score = candidate_results[-1][1]
        logger.info(f"[PIPELINE] Token matches: {n} in {elapsed:.2f}s ({top_score:.3f}–{bot_score:.3f})  top: {top_name[:60]}... ({top_score:.3f})")
    else:
        logger.warning(f"{BRIGHT_RED}[PIPELINE] Token matches: 0 candidates in {elapsed:.2f}s{RESET}")
    return candidate_results, elapsed


async def _run_ranking_step(entity_profile: list, candidates: list, query: str, steps: list[str], lr_cfg: dict, tm_cfg: dict, llm_warnings: list[str] | None = None, usage_out: dict | None = None) -> tuple:
    """Step 3: LLM ranking. Returns (llm_response, ranking_debug, elapsed_time).

    When *usage_out* is provided, it is populated with the LLM call's token
    usage (``{"input", "output"}``).
    """
    run_llm_ranking = "llm_ranking" in steps
    max_token_candidates = tm_cfg["max_token_candidates"]

    t0 = time.time()
    if not run_llm_ranking:
        logger.info(WHITE + "[PIPELINE] Step 3: Skipping LLM ranking (using token scores)" + RESET)
        llm_response = {
            "ranked_candidates": [
                {"candidate": term, "relevance_score": score, "core_concept_score": score, "spec_score": 0}
                for term, score in candidates[:max_token_candidates]
            ]
        }
        ranking_debug = {"inputs": {"candidate_ranking": candidates[:max_token_candidates]}}
    else:
        logger.info(YELLOW + "[PIPELINE] Step 3: Ranking with LLM" + RESET)
        llm_response, ranking_debug = await call_llm_for_ranking(
            entity_profile, candidates, query,
            lr_cfg=lr_cfg,
            warnings=llm_warnings,
            usage_out=usage_out,
        )
    elapsed = round(time.time() - t0, 3) if run_llm_ranking else None
    return llm_response, ranking_debug, elapsed


# ---------------------------------------------------------------------------
# Step wrapper functions — uniform signature for the dispatch loop
# ---------------------------------------------------------------------------

async def _step_cache_lookup(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    """Cache lookup is handled externally by the frontend — always SKIPPED here."""
    return StepResult(output=None, elapsed=0.0, status=StepStatus.SKIPPED)


async def _step_fuzzy(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    """Fuzzy matching against session terms."""
    terms = ctx.get_output("_session_terms", [])
    try:
        results, elapsed = _run_fuzzy_step(query, terms, cfg)
    except Exception as e:
        logger.error("[PIPELINE] Fuzzy matching failed: %s — continuing", e)
        return StepResult(output=[], elapsed=0.0, status=StepStatus.FAILED,
                          warnings=[StepWarning("fuzzy_matching", "step_error", f"Fuzzy matching failed: {e}")])

    # Determine if fuzzy is the last step — if so, terminate the pipeline
    req = ctx.requested_steps
    fuzzy_idx = req.index("fuzzy_matching") if "fuzzy_matching" in req else -1
    is_last = fuzzy_idx == len(req) - 1

    if is_last:
        # Build early-exit response and store it
        fuzzy_ranking = [{"candidate": t, "relevance_score": s} for t, s in results]
        ctx.set_output("_early_response", _ok(
            message=f"Fuzzy matching completed - {len(results)} matches in {ctx.total_time}s",
            data={
                "final_ranking": fuzzy_ranking,
                "total_time": ctx.total_time,
                "step_timings": ctx.step_timings,
                "pipeline_params": {"steps": ["fuzzy_matching"], "fuzzy_matching": cfg},
                "terminated_at": "fuzzy_matching",
                "diagnostics": ctx.build_diagnostics(),
            },
        ))

    return StepResult(output=results, elapsed=elapsed, terminates=is_last)


async def _step_web_search(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    """Sentinel — actual web search runs inside _step_entity_profiling (coupled function)."""
    if "entity_profiling" in ctx.requested_steps:
        # Will be handled by _step_entity_profiling
        return StepResult(output=None, elapsed=0.0, status=StepStatus.SKIPPED)
    # web_search without entity_profiling is not a supported configuration
    return StepResult(output=None, elapsed=0.0, status=StepStatus.SKIPPED)


async def _step_entity_profiling(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    """Combined web search + entity profiling (coupled underlying function).

    Records both web_search and entity_profiling statuses in ctx.
    """
    steps = ctx.requested_steps
    ws_cfg = ctx.params.get("web_search", {})
    ep_cfg = ctx.params.get("entity_profiling", {})

    # Branch 1: entity_profiling precomputed — both steps done
    if ctx.get_output("entity_profiling") is not None:
        profile_debug = {"inputs": {"scraped_sources": {"status": "precomputed"}}, "warnings": [], "scraped_content": []}
        ctx.set_output("_profile_debug", profile_debug)
        ctx.record_step("web_search", StepStatus.PRECOMPUTED, elapsed=0.0)
        return StepResult(
            output=ctx.get_output("entity_profiling"),
            elapsed=0.0,
            status=StepStatus.PRECOMPUTED,
        )

    # Branch 2: web_search precomputed — re-run entity profiling with cached web content
    precomputed_web = ctx.get_output("web_search")
    scraped_content = precomputed_web if precomputed_web is not None else None

    if precomputed_web is not None:
        ctx.record_step("web_search", StepStatus.PRECOMPUTED, elapsed=0.0)

    try:
        ep_llm_warnings = []
        ep_usage: dict = {}
        entity_profile, profile_debug, ep_time, ws_time = await _run_research_step(
            query, steps, ws_cfg, ep_cfg,
            llm_warnings=ep_llm_warnings,
            scraped_content=scraped_content,
            usage_out=ep_usage,
        )
        ctx.record_step_tokens("entity_profiling", ep_usage)
        # Surface warnings
        for w in profile_debug.get("warnings", []):
            ctx.add_warning(w["step"], w["code"], w["message"], details=w.get("details"), stats=w.get("stats"))
        for msg in ep_llm_warnings:
            ctx.add_warning("entity_profiling", "llm_retry", msg)

        # Store scraped content for node_outputs
        ctx.set_output("_profile_debug", profile_debug)
        if profile_debug.get("scraped_content"):
            ctx.set_output("_scraped_content", profile_debug["scraped_content"])

        # Determine statuses
        scraped = profile_debug["inputs"]["scraped_sources"]
        if scraped.get("status") == "skipped":
            if precomputed_web is None:
                ctx.record_step("web_search", StepStatus.SKIPPED)
            ep_status = StepStatus.SKIPPED
        elif "error" in scraped:
            if precomputed_web is None:
                ctx.record_step("web_search", StepStatus.FAILED, elapsed=ws_time)
            ep_status = StepStatus.DEGRADED
        else:
            if precomputed_web is None:
                has_ws_warnings = any(w.get("step") == "web_search" for w in profile_debug.get("warnings", []))
                ws_status = StepStatus.DEGRADED if has_ws_warnings else StepStatus.SUCCESS
                ctx.record_step("web_search", ws_status, elapsed=ws_time)
            ep_status = StepStatus.DEGRADED if ep_llm_warnings else StepStatus.SUCCESS

        return StepResult(output=entity_profile, elapsed=ep_time or 0.0, status=ep_status)

    except HTTPException as e:
        logger.warning("[PIPELINE] Entity profiling failed — continuing with token matching only")
        profile_debug = {"inputs": {"scraped_sources": {"status": "error", "error": e.detail}}, "warnings": []}
        if scraped_content is not None:
            profile_debug["scraped_content"] = scraped_content
        ctx.set_output("_profile_debug", profile_debug)
        if precomputed_web is None:
            ctx.record_step("web_search", StepStatus.FAILED)
        return StepResult(
            output=[],
            elapsed=0.0,
            status=StepStatus.FAILED,
            warnings=[StepWarning("entity_profiling", "llm_error", f"Entity profiling failed: {e.detail}")],
        )


async def _step_token(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    """Token matching — find candidates using tokenized entity profile."""
    entity_profile = ctx.get_output("entity_profiling", [])
    token_matcher = ctx.get_output("_token_matcher")
    if token_matcher is None:
        return StepResult(output=[], elapsed=0.0, status=StepStatus.SKIPPED)

    try:
        results, elapsed = _run_token_step(query, entity_profile, token_matcher)
        return StepResult(output=results, elapsed=elapsed)
    except Exception as e:
        logger.error("[PIPELINE] Token matching failed: %s — continuing with empty candidates", e)
        return StepResult(output=[], elapsed=0.0, status=StepStatus.FAILED,
                          warnings=[StepWarning("token_matching", "step_error", f"Token matching failed: {e}")])


async def _step_ranking(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    """LLM ranking — rank candidates using entity profile context."""
    entity_profile = ctx.get_output("entity_profiling") or []
    candidates = ctx.get_output("token_matching") or []
    lr_cfg = ctx.params.get("llm_ranking", {})
    tm_cfg = ctx.params.get("token_matching", {})

    if not candidates:
        logger.info("[PIPELINE] llm_ranking: no candidates — skipping")
        return StepResult(
            output={"ranked_candidates": []},
            elapsed=0.0,
            status=StepStatus.SKIPPED,
        )

    try:
        ranking_llm_warnings = []
        lr_usage: dict = {}
        llm_response, ranking_debug, elapsed = await _run_ranking_step(
            entity_profile, candidates, query,
            ctx.requested_steps, lr_cfg, tm_cfg,
            llm_warnings=ranking_llm_warnings,
            usage_out=lr_usage,
        )
        ctx.record_step_tokens("llm_ranking", lr_usage)
        ctx.set_output("_ranking_debug", ranking_debug)

        if "llm_ranking" not in ctx.requested_steps:
            return StepResult(output=llm_response, elapsed=0.0, status=StepStatus.SKIPPED)

        warnings = [StepWarning("llm_ranking", "llm_retry", msg) for msg in ranking_llm_warnings]
        status = StepStatus.DEGRADED if ranking_llm_warnings else StepStatus.SUCCESS
        return StepResult(output=llm_response, elapsed=elapsed or 0.0, status=status, warnings=warnings)

    except HTTPException as e:
        max_cands = tm_cfg.get("max_token_candidates", 20)
        logger.error(
            "[PIPELINE] LLM ranking failed (%d: %s) — falling back to token match scores (%d candidates)",
            e.status_code, e.detail, len(candidates[:max_cands]),
        )
        llm_response = {
            "ranked_candidates": [
                {"candidate": term, "relevance_score": score, "core_concept_score": score, "spec_score": 0}
                for term, score in candidates[:max_cands]
            ]
        }
        ranking_debug = {
            "inputs": {"candidate_ranking": candidates[:max_cands]},
            "error": e.detail,
        }
        ctx.set_output("_ranking_debug", ranking_debug)
        return StepResult(
            output=llm_response, elapsed=0.0, status=StepStatus.FAILED,
            warnings=[StepWarning("llm_ranking", "llm_fallback", f"LLM ranking failed, using token scores: {e.detail}")],
        )


async def _step_llm_only(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    """Generic LLM call — send prompt + query, get text response."""
    # Start line is emitted by llm_call() via node_name=, so no separate tag here.
    t0 = time.time()

    system = cfg.get("prompt", "")
    provider = cfg["provider"]
    model = cfg["model"]
    temperature = cfg.get("temperature", 0.0)
    max_tokens = cfg.get("max_tokens")
    response_format = cfg.get("response_format", "text")
    reasoning_effort = cfg.get("reasoning_effort")

    messages = [{"role": "user", "content": query}]
    call_warnings: list[str] = []
    kwargs: dict[str, Any] = {
        "messages": messages,
        "provider": provider,
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "warnings": call_warnings,
    }
    if system:
        kwargs["system"] = system
    if response_format == "json":
        kwargs["output_format"] = "json"
    if reasoning_effort is not None:
        kwargs["reasoning_effort"] = reasoning_effort

    llm_only_usage: dict = {}
    response = await llm_call(**kwargs, usage_out=llm_only_usage, node_name="llm_only")
    answer = response if isinstance(response, str) else response.get("output", json.dumps(response))
    elapsed = round(time.time() - t0, 3)
    ctx.record_step_tokens("llm_only", llm_only_usage)

    # Split ``"code: message"`` strings emitted by ``llm_call`` into the
    # StepWarning(step, code, message) shape so PromptPotter's classifier sees
    # a clean code (e.g. ``content_empty``) instead of the whole verbose line.
    # Strings without ``": "`` keep the legacy behavior (string used as both).
    step_warnings: list[StepWarning] = []
    for w in call_warnings:
        if ": " in w:
            code, _, msg = w.partition(": ")
            step_warnings.append(StepWarning("llm_only", code, msg))
        else:
            step_warnings.append(StepWarning("llm_only", w, w))
    if not answer.strip():
        logger.warning("[PIPELINE] llm_only: empty output after %ss", elapsed)
        step_warnings.append(
            StepWarning("llm_only", "empty_output", "LLM returned empty content")
        )

    # Build early-exit response
    final_ranking = [{"candidate": answer.strip(), "score": 1.0}]
    warning_dicts = [
        {"step": w.step, "code": w.code, "message": w.message} for w in step_warnings
    ]
    step_status = "success" if answer.strip() else "empty_output"
    early_data: dict = {
        "final_ranking": final_ranking,
        "node_outputs": {},
        "step_timings": {"llm_only": elapsed},
        "total_time": elapsed,
        "terminated_at": "llm_only",
        "pipeline_params": {"steps": ["llm_only"], "llm_only": cfg},
        "llm_provider": provider,
        "diagnostics": {"warnings": warning_dicts, "step_statuses": {"llm_only": step_status}},
    }
    if llm_only_usage:
        early_data["step_tokens"] = {"llm_only": dict(llm_only_usage)}
    ctx.set_output("_early_response", _ok(
        message=f"LLM-only completed in {elapsed}s",
        data=early_data,
    ))

    return StepResult(
        output={"final_ranking": final_ranking},
        elapsed=elapsed,
        terminates=True,
        warnings=step_warnings,
    )


# ---------------------------------------------------------------------------
# Step registry + session requirements
# ---------------------------------------------------------------------------

STEP_REGISTRY: dict[str, Callable] = {
    "cache_lookup":      _step_cache_lookup,
    "fuzzy_matching":    _step_fuzzy,
    "web_search":        _step_web_search,
    "entity_profiling":  _step_entity_profiling,
    "token_matching":    _step_token,
    "llm_ranking":       _step_ranking,
    "llm_only":          _step_llm_only,
}

REQUIRES_SESSION = get_session_required_steps()


def _deserialize_scored_tuples(data: list[dict]) -> list[tuple[str, float]]:
    """Deserialize ``[{term, score}, ...]`` dicts back to internal tuple format."""
    return [(r["term"], r["score"]) for r in data]


PRECOMPUTED_DESERIALIZERS: dict[str, Callable] = {
    "fuzzy_matching": _deserialize_scored_tuples,
    "token_matching": _deserialize_scored_tuples,
}


def _serialize_scored_tuples(data: list[tuple[str, float]]) -> list[dict]:
    """Serialize internal ``[(term, score), ...]`` tuples to wire format."""
    return [{"term": t, "score": s} for t, s in data]


def _identity(data: Any) -> Any:
    return data


# (context_key, serializer) — context_key is the output name to read from ctx.
# Nodes not listed here are excluded from node_outputs.
NODE_OUTPUT_SERIALIZERS: dict[str, tuple[str, Callable]] = {
    "fuzzy_matching":    ("fuzzy_matching", _serialize_scored_tuples),
    "web_search":        ("_scraped_content", _identity),
    "entity_profiling":  ("entity_profiling", _identity),
    "token_matching":    ("token_matching", _serialize_scored_tuples),
}


# ---------------------------------------------------------------------------
# Response building
# ---------------------------------------------------------------------------

def _build_response(ctx: PipelineContext) -> tuple:
    """Build training_record and api_response from PipelineContext outputs.

    Returns (training_record, api_response).
    """
    entity_profile = ctx.get_output("entity_profiling") or []
    llm_response = ctx.get_output("llm_ranking") or {}
    candidates = ctx.get_output("token_matching") or []
    profile_debug = ctx.get_output("_profile_debug", {"inputs": {"scraped_sources": {"status": "skipped"}}})
    ranking_debug = ctx.get_output("_ranking_debug")

    ranked = llm_response.get("ranked_candidates", [])
    target = ranked[0].get("candidate") if ranked else "No matches found"
    confidence = ranked[0].get("relevance_score", 0) if ranked else 0

    # Three-state web_search_status (backward compat)
    scraped_sources = profile_debug["inputs"]["scraped_sources"]
    if scraped_sources.get("status") in ("skipped", "precomputed"):
        web_status, web_error, web_sources = scraped_sources["status"], None, []
    elif "error" in scraped_sources:
        web_status, web_error, web_sources = "failed", scraped_sources["error"], []
    else:
        web_status, web_error = "success", None
        web_sources = scraped_sources.get("sources_fetched", [])

    step_timings = ctx.step_timings
    step_tokens = ctx.step_tokens
    total_time = ctx.total_time
    pipeline_params = {
        "steps": ctx.executed_steps,
        "requested_steps": ctx.requested_steps,
        **ctx.params,
    }

    ep_cfg = ctx.params.get("entity_profiling", {})
    lr_cfg = ctx.params.get("llm_ranking", {})
    training_record = {
        "source": ctx.query, "target": target, "method": "ProfileRank",
        "confidence": confidence, "session_id": ctx.user_id,
        "profiling_provider": ep_cfg.get("provider"),
        "profiling_model": ep_cfg.get("model"),
        "ranking_provider": lr_cfg.get("provider"),
        "ranking_model": lr_cfg.get("model"),
        "total_time": total_time, "web_search_status": web_status, "error": web_error,
        "step_timings": step_timings,
        "step_tokens": step_tokens,
        "pipeline_params": pipeline_params,
        "entity_profile": entity_profile,
        "candidates": [
            {"rank": i, "name": c.get("candidate"), "score": c.get("relevance_score"),
             "core_score": c.get("core_concept_score"), "spec_score": c.get("spec_score")}
            for i, c in enumerate(ranked)
        ] if ranked else [],
        "token_matches": ranking_debug["inputs"]["candidate_ranking"] if ranking_debug else [],
        "web_sources": web_sources,
    }

    # Node outputs for partial pipeline caching (registry-driven)
    _ran = {StepStatus.SUCCESS, StepStatus.DEGRADED}
    statuses = {name: rec.status for name, rec in ctx._steps.items()}
    node_outputs: dict = {}
    for node_name, (ctx_key, serializer) in NODE_OUTPUT_SERIALIZERS.items():
        if statuses.get(node_name) in _ran:
            raw = ctx.get_output(ctx_key)
            if raw is not None:
                node_outputs[node_name] = serializer(raw)

    data = {
        "final_ranking": ranked, "entity_profile": entity_profile,
        "candidate_ranking": candidates[:ctx.params.get("token_matching", {}).get("max_token_candidates", 20)],
        "profiling_provider": ep_cfg.get("provider"),
        "profiling_model": ep_cfg.get("model"),
        "ranking_provider": lr_cfg.get("provider"),
        "ranking_model": lr_cfg.get("model"),
        "total_time": total_time,
        "step_timings": step_timings,
        "web_search_status": web_status,
        "web_search_error": web_error, "pipeline_params": pipeline_params,
        "terminated_at": ctx.terminated_at,
        "diagnostics": ctx.build_diagnostics(),
    }
    if step_tokens:
        data["step_tokens"] = step_tokens
    if node_outputs:
        data["node_outputs"] = node_outputs
    api_response = _ok(
        message=f"Research completed - Found {len(ranked)} matches in {total_time}s",
        data=data,
    )
    return training_record, api_response


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
            raise HTTPException(status_code=400, detail="No session found - initialize session first with POST /sessions")
        terms = user_sessions[user_id]["terms"]
    else:
        terms = []

    # Single request entry — merges incoming-step bookkeeping with user/query
    # preview into one structured [REQ ] line. Optional fields drop out via
    # fmt_fields when their value is None/empty.
    overrides = list((payload.get("node_config") or {}).keys())
    query_display = query if len(query) <= 25 else f"{query[:25]}…"
    body = fmt_fields(
        "/matches",
        ("user", user_id),
        ("steps", fmt_list(steps)),
        ("default_steps", fmt_list(steps) if not payload_steps else None),
        ("overrides", fmt_list(overrides) if overrides else None),
        ("terms", len(terms) if terms else None),
        ("precomputed", fmt_list(precomputed) if precomputed else None),
        ("chars", len(query)),
        ("query", f'"{query_display}"'),
    )
    logger.info(f"{RED}{TAG_REQ} {body}{RESET}")

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
            logger.error("%s %s failed · %s", TAG_STEP, step_name, exc)
            ctx.record_step(step_name, StepStatus.FAILED)
            ctx.add_warning(step_name, "step_error", f"{step_name} failed: {exc}")
            result = StepResult(output=None, elapsed=0.0, status=StepStatus.FAILED)

        # Record step (step functions may also record internally for coupled steps)
        ctx.record_step(step_name, result.status, elapsed=result.elapsed)
        ctx.set_output(step_name, result.output)
        for w in result.warnings:
            ctx.add_warning(step_name, w.code, w.message,
                            details=list(w.details) if w.details else None,
                            stats=dict(w.stats) if w.stats else None)

        # Short-form per-step log: only for non-terminal, non-skipped steps.
        # Terminal steps (llm_only, fuzzy-as-last) flow through log_run_summary instead.
        if (
            not result.terminates
            and result.status != StepStatus.SKIPPED
            and step_name in STEP_NODE_TYPE
        ):
            log_step_short(ctx, step_name, STEP_NODE_TYPE[step_name], result)

        if result.terminates:
            break

    # Check for early-exit response (fuzzy-only, llm_only, etc.)
    early = ctx.get_output("_early_response")
    if early is not None:
        log_run_summary(ctx, early)
        return early

    # Full pipeline — build response from collected outputs
    training_record, api_response = _build_response(ctx)
    log_run_summary(ctx, api_response)

    try:
        log_pipeline(training_record, session_id=user_id, trace_id=trace_id)
    except Exception as e:
        logger.error(f"[LANGFUSE] Failed to log: {e}")

    update_match_database(training_record)
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

    logger.info(f"[BATCH] Started batch {batch_id}: {method}, {item_count} items")

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

    logger.info(f"[BATCH] Completed batch {batch_id}: {success_count} success, {error_count} errors")

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

    logger.info(f"[DIRECT_PROMPT] query='{query[:30]}', batch_id={batch_id}")

    if not query:
        raise HTTPException(400, "Query is required")
    if not user_prompt:
        raise HTTPException(400, "user_prompt is required")

    if user_id not in user_sessions:
        raise HTTPException(400, "No session found - initialize session first with POST /sessions")

    terms = user_sessions[user_id]["terms"]
    start_time = time.time()

    # Resolve direct_prompt node config (pipeline.json base + request overrides)
    _dp = _node("direct_prompt")
    _dp_ov = payload.get("node_config", {}).get("direct_prompt", {})
    dp_provider = _dp_ov.get("provider", _dp["provider"])
    dp_model = _dp_ov.get("model", _dp["model"])
    dp_temperature = _dp_ov.get("temperature", _dp["temperature"])
    dp_max_tokens = _dp_ov.get("max_tokens", _dp["max_tokens"])

    # Build system prompt for general LLM inference
    context_sections = []
    if project_context:
        context_sections.append(f"PROJECT CONTEXT:\n{project_context}")
    context_sections.append(f"USER INSTRUCTIONS:\n{user_prompt}")
    if current_output:
        context_sections.append(f"Current output value: {current_output}")

    system_prompt = f"""You are a helpful assistant that processes text according to user instructions.

{chr(10).join(context_sections)}

For the given input, apply the user's instructions and return a JSON object:
{{
    "output": "the processed/transformed result",
    "confidence": 0.0-1.0,
    "reasoning": "brief explanation of what you did"
}}

Return ONLY valid JSON."""

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

        target = response.get("output", query)  # Default to original if no output
        confidence = float(response.get("confidence", 0.5))
        reasoning = response.get("reasoning", "")

    except Exception as e:
        logger.error(f"[DIRECT_PROMPT] LLM error: {e}")
        return {"status": "error", "message": f"LLM error: {str(e)}"}

    total_time = round(time.time() - start_time, 2)

    # VALIDATION: Fuzzy match LLM output against session terms
    # Get top 10 closest matches and decide: accept, correct, or return candidates
    fuzzy_corrected = False
    needs_user_selection = False
    candidates = []
    fuzzy_score = 0.0
    original_target = None

    top_matches = find_top_matches(target, terms, n=_dp["correction_top_n"])
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

    logger.info(f"[DIRECT_PROMPT] {query[:30]}... -> {target[:30]} ({confidence:.0%}) in {total_time}s")

    return _ok(
        message="Direct prompt completed",
        data={
            "target": target, "confidence": confidence, "reasoning": reasoning,
            "total_time": total_time, "fuzzy_score": fuzzy_score,
            "fuzzy_corrected": fuzzy_corrected, "original_target": original_target,
            "needs_user_selection": needs_user_selection, "candidates": candidates,
        }
    )


# =============================================================================
# FRONTEND LOGGING ENDPOINTS
# =============================================================================

from pydantic import BaseModel


class LogMatchRequest(BaseModel):
    """Request body for /log-match endpoint"""
    source: str                    # Original input term
    target: str                    # Matched result
    method: str                    # "cached" | "fuzzy"
    confidence: float              # 1.0 for cache, similarity score for fuzzy
    workbook_id: str | None = None
    latency_ms: float | None = None
    matched_key: str | None = None      # Key that matched (fuzzy only)
    direction: str | None = None        # "forward" | "reverse"


class LogActivityRequest(BaseModel):
    """Request body for /log-activity endpoint"""
    source: str
    target: str
    method: str                    # "UserChoice" | "DirectEdit"
    confidence: float
    timestamp: str | None = None


@router.post("/activities/matches")
async def log_match(request: Request, payload: LogMatchRequest) -> dict[str, Any]:
    """
    Log cache/fuzzy match events from frontend to Langfuse.

    Called fire-and-forget by frontend after cache/fuzzy matches return.
    Creates trace, observation, scores, and links to dataset item.
    """
    user_id = getattr(request.state, 'user_id', 'anonymous')

    try:
        if payload.method == "cached":
            trace_id = log_cache_match(
                source=payload.source,
                target=payload.target,
                latency_ms=payload.latency_ms or 0,
                user_id=user_id,
                session_id=user_id,
            )
        elif payload.method == "fuzzy":
            trace_id = log_fuzzy_match(
                source=payload.source,
                target=payload.target,
                confidence=payload.confidence,
                matched_key=payload.matched_key,
                direction=payload.direction,
                latency_ms=payload.latency_ms or 0,
                user_id=user_id,
                session_id=user_id,
            )
        else:
            raise HTTPException(400, f"Unknown method: {payload.method}")

        logger.info(f"[LOG_MATCH] {payload.method}: {payload.source[:30]}... -> {payload.target[:30]}... ({trace_id})")

        return _ok(
            message=f"{payload.method} match logged",
            data={"trace_id": trace_id}
        )

    except Exception as e:
        logger.error(f"[LOG_MATCH] Error: {e}")
        return {"status": "error", "message": str(e)}


@router.post("/activities")
async def log_activity(request: Request, payload: LogActivityRequest) -> dict[str, Any]:
    """
    Log user corrections (UserChoice, DirectEdit) from frontend to Langfuse.

    Called by frontend when user selects a candidate or directly edits output.
    Updates ground truth in dataset item.
    """
    try:
        success = log_user_correction(
            source=payload.source,
            target=payload.target,
            method=payload.method,
        )

        logger.info(f"[LOG_ACTIVITY] {payload.method}: {payload.source[:30]}... -> {payload.target[:30]}...")

        return _ok(
            message=f"{payload.method} logged",
            data={"success": success}
        )

    except Exception as e:
        logger.error(f"[LOG_ACTIVITY] Error: {e}")
        return {"status": "error", "message": str(e)}