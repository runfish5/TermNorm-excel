"""
Research Pipeline API - Session-based term matching
"""
import json
import logging
import time
from datetime import datetime
from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException, Request, Body

from research_and_rank.web_generate_entity_profile import web_generate_entity_profile
from research_and_rank.display_profile import display_profile
from research_and_rank.call_llm_for_ranking import call_llm_for_ranking
from research_and_rank.correct_candidate_strings import find_top_matches
from research_and_rank.fuzzy_matching import fuzzy_match_terms
from research_and_rank.token_matcher import TokenLookupMatcher
from core.llm_providers import llm_call, LLM_PROVIDER
from core.pipeline_context import PipelineContext, StepStatus, StepWarning
import utils.utils as utils
from utils.utils import RED, YELLOW, GREEN, WHITE, BRIGHT_RED, RESET
from utils.responses import success_response
from services.match_database import get_db as get_match_database, get_cache_metadata, update as update_match_database
from utils.langfuse_logger import (
    log_batch_start, log_batch_complete, log_pipeline,
    log_cache_match, log_fuzzy_match, log_user_correction
)
from utils.schema_registry import get_schema_registry
from config.settings import settings
from config.pipeline_config import get_node_config, get_pipeline_steps

logger = logging.getLogger(__name__)

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
async def init_terms(request: Request, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
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

    return success_response(
        message=f"Session initialized with {len(terms)} terms",
        data={"term_count": len(terms)}
    )


def _resolve_pipeline_params(
    payload: Dict[str, Any],
    steps: List[str] | None = None,
) -> Dict[str, Any]:
    """Extract pipeline parameters from node_config — no hidden defaults for LLM nodes.

    LLM nodes (entity_profiling, llm_ranking) require explicit config in
    node_config.  Returns 422 if required params (model, temperature,
    max_tokens) are missing for an active LLM node.  Non-LLM nodes fall
    back to pipeline.json defaults for non-critical params.
    """
    ov = payload.get("node_config", {})
    active = set(steps or _pipeline("default"))

    # -- LLM nodes: require explicit config, no silent fallbacks ----------
    _LLM_REQUIRED = ("model", "temperature", "max_tokens")

    params: Dict[str, Any] = {}

    if "entity_profiling" in active:
        ep = ov.get("entity_profiling", {})
        missing = [k for k in _LLM_REQUIRED if k not in ep]
        if missing:
            raise HTTPException(
                422,
                f"entity_profiling missing required params: {missing}. "
                "Send full node_config from GET /pipeline.",
            )
        params["profiling_model"] = ep["model"]
        params["profiling_temperature"] = ep["temperature"]
        params["profiling_max_tokens"] = ep["max_tokens"]
        params["raw_content_limit"] = ep.get("raw_content_limit", 5000)
        params["profiling_prompt"] = ep.get("prompt")
        params["profiling_schema"] = ep.get("output_schema")

    if "llm_ranking" in active:
        lr = ov.get("llm_ranking", {})
        missing = [k for k in _LLM_REQUIRED if k not in lr]
        if missing:
            raise HTTPException(
                422,
                f"llm_ranking missing required params: {missing}. "
                "Send full node_config from GET /pipeline.",
            )
        params["ranking_model"] = lr["model"]
        params["ranking_temperature"] = lr["temperature"]
        params["ranking_max_tokens"] = lr["max_tokens"]
        params["ranking_sample_size"] = lr.get("sample_size", 20)
        params["ranking_prompt"] = lr.get("prompt")
        params["ranking_schema"] = lr.get("output_schema")
        params["relevance_weight_core"] = lr.get("relevance_weight_core", 0.7)
        params["debug_output_limit"] = lr.get("debug_output_limit", 20)

    # -- Non-LLM nodes: pipeline.json defaults for non-critical params ----
    if "web_search" in active:
        ws = ov.get("web_search", {})
        _ws = _node("web_search")
        params["max_sites"] = ws.get("max_sites", _ws["max_sites"])
        params["num_results"] = ws.get("num_results", _ws["num_results"])
        params["content_char_limit"] = ws.get("content_char_limit", _ws["content_char_limit"])
        params["query_prefix"] = ws.get("query_prefix", _ws.get("query_prefix", ""))
        params["query_suffix"] = ws.get("query_suffix", _ws.get("query_suffix", ""))

    if "token_matching" in active:
        tm = ov.get("token_matching", {})
        _tm = _node("token_matching")
        params["max_token_candidates"] = tm.get("max_token_candidates", _tm["max_token_candidates"])

    if "fuzzy_matching" in active:
        fm = ov.get("fuzzy_matching", {})
        _fm = _node("fuzzy_matching")
        params["fuzzy_threshold"] = fm.get("threshold", _fm["threshold"])
        params["fuzzy_scorer"] = fm.get("scorer", _fm["scorer"])
        params["fuzzy_limit"] = fm.get("limit", _fm["limit"])

    return params


def _run_fuzzy_step(query: str, terms: List[str], params: Dict) -> tuple:
    """Step 0: Fuzzy matching. Returns (results, elapsed_time)."""
    print(RED + "[PIPELINE] Step 0: Fuzzy matching" + RESET)
    t0 = time.time()
    results = fuzzy_match_terms(
        query, terms, threshold=params["fuzzy_threshold"], scorer=params["fuzzy_scorer"], limit=params["fuzzy_limit"]
    )
    elapsed = round(time.time() - t0, 3)
    print(f"[PIPELINE] Fuzzy: {len(results)} matches in {elapsed}s")
    return results, elapsed


async def _run_research_step(query: str, steps: List[str], params: Dict, llm_warnings: list[str] | None = None) -> tuple:
    """Step 1: Web search + entity profiling.
    Returns (entity_profile, profile_debug, ep_time, ws_time).
    Times are None when the step was skipped."""
    run_web_search = "web_search" in steps
    run_entity_profiling = "entity_profiling" in steps

    if not run_entity_profiling:
        print(WHITE + "[PIPELINE] Step 1: Skipping entity profiling" + RESET)
        profile_debug = {"inputs": {"scraped_sources": {"status": "skipped", "note": "Skipped by pipeline steps"}}}
        return [], profile_debug, None, None

    effective_max_tokens = params["profiling_max_tokens"]
    print(RED + "[PIPELINE] Step 1: Researching" + (" (LLM knowledge only)" if not run_web_search else "") + RESET)
    entity_profile, profile_debug = await web_generate_entity_profile(
        query,
        max_sites=params["max_sites"],
        schema=ENTITY_SCHEMA,
        content_char_limit=params["content_char_limit"],
        raw_content_limit=params["raw_content_limit"],
        num_results=params["num_results"],
        profiling_temperature=params["profiling_temperature"],
        profiling_max_tokens=effective_max_tokens,
        skip_search=not run_web_search,
        profiling_prompt=params.get("profiling_prompt"),
        profiling_schema=params.get("profiling_schema"),
        profiling_model=params.get("profiling_model"),
        query_prefix=params.get("query_prefix", ""),
        query_suffix=params.get("query_suffix", ""),
        warnings=llm_warnings,
    )
    logger.debug("[PIPELINE] Entity profile: %s", entity_profile)
    ep_time = profile_debug.get("llm_elapsed")
    ws_time = profile_debug.get("web_search_elapsed")
    return entity_profile, profile_debug, ep_time, ws_time


def _run_token_step(query: str, entity_profile: list, token_matcher: "TokenLookupMatcher") -> tuple:
    """Step 2: Token matching. Returns (candidate_results, elapsed_time)."""
    print(YELLOW + "[PIPELINE] Step 2: Matching candidates" + RESET)
    search_terms = [word for s in [query] + utils.flatten_strings(entity_profile) for word in s.split()]
    unique_search_terms = list(set(search_terms))

    print(f"[PIPELINE] {len(unique_search_terms)} profile terms (from {len(search_terms)}): {', '.join(unique_search_terms[:20])}{'...' if len(unique_search_terms) > 20 else ''}")

    t0 = time.time()
    candidate_results = token_matcher.match(unique_search_terms)
    elapsed = round(time.time() - t0, 3)

    n = len(candidate_results)
    if n:
        top_name, top_score = candidate_results[0]
        bot_score = candidate_results[-1][1]
        print(f"[PIPELINE] Token matches: {n} in {elapsed:.2f}s ({top_score:.3f}–{bot_score:.3f})  top: {top_name[:60]}... ({top_score:.3f})")
    else:
        print(f"{BRIGHT_RED}[PIPELINE] Token matches: 0 candidates in {elapsed:.2f}s{RESET}")
    return candidate_results, elapsed


async def _run_ranking_step(entity_profile: list, candidates: list, query: str, steps: List[str], params: Dict, llm_warnings: list[str] | None = None) -> tuple:
    """Step 3: LLM ranking. Returns (llm_response, ranking_debug, elapsed_time)."""
    run_llm_ranking = "llm_ranking" in steps
    max_token_candidates = params["max_token_candidates"]

    t0 = time.time()
    if not run_llm_ranking:
        print(WHITE + "[PIPELINE] Step 3: Skipping LLM ranking (using token scores)" + RESET)
        llm_response = {
            "ranked_candidates": [
                {"candidate": term, "relevance_score": score, "core_concept_score": score, "spec_score": 0}
                for term, score in candidates[:max_token_candidates]
            ]
        }
        ranking_debug = {"inputs": {"token_matched_candidates": candidates[:max_token_candidates]}}
    else:
        print(YELLOW + "[PIPELINE] Step 3: Ranking with LLM" + RESET)
        profile_info = display_profile(entity_profile, "RESEARCH PROFILE")
        llm_response, ranking_debug = await call_llm_for_ranking(
            profile_info, entity_profile, candidates, query,
            temperature=params["ranking_temperature"],
            max_tokens=params["ranking_max_tokens"],
            sample_size=params["ranking_sample_size"],
            relevance_weight_core=params["relevance_weight_core"],
            ranking_prompt=params["ranking_prompt"],
            ranking_schema=params.get("ranking_schema"),
            ranking_model=params.get("ranking_model"),
            debug_output_limit=params["debug_output_limit"],
            warnings=llm_warnings,
        )
    elapsed = round(time.time() - t0, 3) if run_llm_ranking else None
    return llm_response, ranking_debug, elapsed


def _derive_executed_steps(step_timings: dict) -> list[str]:
    """Derive which steps actually executed from step_timings.
    Non-None timing = step ran. Order follows pipeline execution order."""
    return [step for step, t in step_timings.items() if t is not None]


def _summarize_response(resp: dict) -> str:
    """Build a condensed structural summary of the API response for logging."""
    G, R = GREEN, RESET
    lines = [f"{G}[RESPONSE] {resp.get('status', '?')} — {resp.get('message', '')}{R}"]
    data = resp.get("data", {})

    # ranked_candidates
    ranked = data.get("ranked_candidates", [])
    if ranked:
        top = ranked[0]
        name = top.get("candidate", "")[:50]
        score = top.get("relevance_score", 0)
        lines.append(f"  {G}ranked_candidates{R}  [{len(ranked)} items]  top: {name}... ({score:.3f})")

    # entity_profile
    ep = data.get("entity_profile")
    if isinstance(ep, dict):
        n_fields = len([k for k in ep if not k.startswith("_")])
        entity = ep.get("entity_name", "?")[:40]
        src_count = ep.get("_metadata", {}).get("sources_count", "?")
        lines.append(f"  {G}entity_profile{R}      {{{n_fields} fields}}  entity: {entity}, {src_count} sources")

    # token_matched_candidates
    tokens = data.get("token_matched_candidates", [])
    if tokens:
        scores = [c[1] for c in tokens if isinstance(c, (list, tuple)) and len(c) > 1]
        rng = f"  scores: {max(scores):.3f}–{min(scores):.3f}" if scores else ""
        lines.append(f"  {G}token_candidates{R}   [{len(tokens)} items]{rng}")

    # timings (merged total_time + step_timings)
    step_timings = data.get("step_timings", {})
    total_time = data.get("total_time")
    if step_timings:
        parts = []
        for step, t in step_timings.items():
            short = step.split("_")[0][:8]
            parts.append(f"{short}={'skip' if t is None else f'{t:.1f}s'}")
        total_str = f"{total_time}s total | " if total_time else ""
        lines.append(f"  {G}timings{R}            {total_str}{' '.join(parts)}")

    # pipeline (merged pipeline_params + terminated_at + models)
    pp = data.get("pipeline_params", {})
    terminated = data.get("terminated_at")
    model = data.get("profiling_model") or data.get("ranking_model") or ""
    provider = data.get("llm_provider", "")
    if pp:
        n_exec = len(pp.get("steps", []))
        n_req = len(pp.get("requested_steps", []))
        term_str = f" → {terminated}" if terminated else ""
        model_str = f" | {provider}/{model.split('/')[-1]}" if model else ""
        lines.append(f"  {G}pipeline{R}           {n_exec}/{n_req} steps{term_str}{model_str}")

    # diagnostics
    diag = data.get("diagnostics")
    if isinstance(diag, dict):
        warnings = diag.get("warnings", [])
        statuses = diag.get("step_statuses", {})
        non_success = [f"{s}={st}" for s, st in statuses.items() if st != "success"]
        status_str = ", ".join(non_success) if non_success else "all success"
        w_str = f"{len(warnings)} warnings"
        if warnings:
            first = warnings[0]
            w_str += f" ({first['step']}: {first['code']})"
        lines.append(f"  {G}diagnostics{R}        {w_str} | {status_str}")

    return "\n".join(lines)


def _build_pipeline_results(
    ctx: PipelineContext,
    llm_response: dict,
    entity_profile: list,
    profile_debug: dict,
    ranking_debug: dict,
    candidates: list,
) -> tuple:
    """Build training record and API response from pipeline results. Returns (training_record, api_response)."""
    ranked = llm_response.get("ranked_candidates", [])
    target = ranked[0].get("candidate") if ranked else "No matches found"
    confidence = ranked[0].get("relevance_score", 0) if ranked else 0

    # Three-state web_search_status derived from execution results (backward compat)
    scraped_sources = profile_debug["inputs"]["scraped_sources"]
    if scraped_sources.get("status") == "skipped":
        web_status, web_error, web_sources = "skipped", None, []
    elif "error" in scraped_sources:
        web_status = "failed"
        web_error = scraped_sources["error"]
        web_sources = []
    else:
        web_status, web_error = "success", None
        web_sources = scraped_sources.get("sources_fetched", [])

    step_timings = ctx.step_timings
    total_time = ctx.total_time
    pipeline_params = {
        "steps": ctx.executed_steps,
        "requested_steps": ctx.requested_steps,
        **ctx.params,
    }

    training_record = {
        "source": ctx.query, "target": target, "method": "ProfileRank",
        "confidence": confidence, "session_id": ctx.user_id,
        "llm_provider": LLM_PROVIDER,
        "profiling_model": ctx.params.get("profiling_model"),
        "ranking_model": ctx.params.get("ranking_model"),
        "total_time": total_time, "web_search_status": web_status, "error": web_error,
        "step_timings": step_timings, "pipeline_params": pipeline_params,
        "entity_profile": entity_profile,
        "candidates": [
            {"rank": i, "name": c.get("candidate"), "score": c.get("relevance_score"),
             "core_score": c.get("core_concept_score"), "spec_score": c.get("spec_score")}
            for i, c in enumerate(ranked)
        ] if ranked else [],
        "token_matches": ranking_debug["inputs"]["token_matched_candidates"] if ranking_debug else [],
        "web_sources": web_sources,
    }

    api_response = success_response(
        message=f"Research completed - Found {len(ranked)} matches in {total_time}s",
        data={
            "ranked_candidates": ranked, "entity_profile": entity_profile,
            "token_matched_candidates": candidates[:ctx.params["max_token_candidates"]],
            "llm_provider": LLM_PROVIDER,
            "profiling_model": ctx.params.get("profiling_model"),
            "ranking_model": ctx.params.get("ranking_model"),
            "total_time": total_time,
            "step_timings": step_timings, "web_search_status": web_status,
            "web_search_error": web_error, "pipeline_params": pipeline_params,
            "terminated_at": ctx.terminated_at,
            "diagnostics": ctx.build_diagnostics(),
        }
    )
    print(_summarize_response(api_response))
    return training_record, api_response


@router.post("/matches")
async def research_and_match(request: Request, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Normalize a term - research and rank candidates using LLM + token matching"""
    user_id = request.state.user_id
    query = payload.get("query", "")
    steps = payload.get("steps") or _pipeline("default")
    trace_id = payload.get("trace_id")

    params = _resolve_pipeline_params(payload, steps=steps)

    if user_id not in user_sessions:
        raise HTTPException(status_code=400, detail="No session found - initialize session first with POST /sessions")

    terms = user_sessions[user_id]["terms"]
    print(f"{RED}[PIPELINE] {user_id}: '{query}' ({len(terms)} terms){RESET}")

    ctx = PipelineContext(query, user_id, requested_steps=steps, params=params)

    # Record cache_lookup (handled externally by match_database, not in this pipeline)
    if steps is not None and "cache_lookup" in steps:
        ctx.record_step("cache_lookup", StepStatus.SKIPPED)

    # Step 0: Fuzzy matching (optional, short-circuits if fuzzy-only)
    fuzzy_results = []
    if steps is not None and "fuzzy_matching" in steps:
        try:
            fuzzy_results, fuzzy_time = _run_fuzzy_step(query, terms, params)
            ctx.record_step("fuzzy_matching", StepStatus.SUCCESS, elapsed=fuzzy_time)
        except Exception as e:
            logger.error("[PIPELINE] Fuzzy matching failed: %s — continuing", e)
            fuzzy_time = None
            ctx.record_step("fuzzy_matching", StepStatus.FAILED)
            ctx.add_warning("fuzzy_matching", "step_error", f"Fuzzy matching failed: {e}")
        if steps == ["fuzzy_matching"]:
            return success_response(
                message=f"Fuzzy matching completed - {len(fuzzy_results)} matches in {ctx.total_time}s",
                data={
                    "ranked_candidates": [{"candidate": t, "relevance_score": s} for t, s in fuzzy_results],
                    "total_time": ctx.total_time,
                    "step_timings": ctx.step_timings,
                    "pipeline_params": {"steps": ["fuzzy_matching"], "fuzzy_threshold": params["fuzzy_threshold"], "fuzzy_scorer": params["fuzzy_scorer"]},
                    "terminated_at": "fuzzy_matching",
                    "diagnostics": ctx.build_diagnostics(),
                }
            )

    # Steps 1-3: Research → Token matching → LLM ranking
    # Each LLM step is wrapped for graceful degradation — if the LLM provider
    # is down (e.g. model decommissioned → 404 → 502), the pipeline continues
    # with whatever data is available rather than crashing the entire request.
    token_matcher = TokenLookupMatcher(terms)
    print(f"[PIPELINE] TokenLookupMatcher: {len(token_matcher.deduplicated_terms)} unique terms")

    try:
        ep_llm_warnings = []
        entity_profile, profile_debug, ep_time, ws_time = await _run_research_step(query, steps, params, llm_warnings=ep_llm_warnings)
        # Surface warnings from web scraping into PipelineContext
        for w in profile_debug.get("warnings", []):
            ctx.add_warning(w["step"], w["code"], w["message"], details=w.get("details"))
        # Surface LLM retry warnings
        for msg in ep_llm_warnings:
            ctx.add_warning("entity_profiling", "llm_retry", msg)
        # Determine web_search step status
        scraped = profile_debug["inputs"]["scraped_sources"]
        if scraped.get("status") == "skipped":
            ctx.record_step("web_search", StepStatus.SKIPPED)
            ctx.record_step("entity_profiling", StepStatus.SKIPPED)
        elif "error" in scraped:
            ctx.record_step("web_search", StepStatus.FAILED, elapsed=ws_time)
            ctx.record_step("entity_profiling", StepStatus.DEGRADED, elapsed=ep_time)
        else:
            has_ws_warnings = any(
                w.get("step") == "web_search" for w in profile_debug.get("warnings", [])
            )
            has_llm_warnings = len(ep_llm_warnings) > 0
            ws_status = StepStatus.DEGRADED if has_ws_warnings else StepStatus.SUCCESS
            ep_status = StepStatus.DEGRADED if has_llm_warnings else StepStatus.SUCCESS
            ctx.record_step("web_search", ws_status, elapsed=ws_time)
            ctx.record_step("entity_profiling", ep_status, elapsed=ep_time)
    except HTTPException as e:
        logger.warning(
            "[PIPELINE] Entity profiling failed — continuing with token matching only",
        )
        entity_profile = []
        profile_debug = {"inputs": {"scraped_sources": {"status": "error", "error": e.detail}}, "warnings": []}
        ctx.record_step("entity_profiling", StepStatus.FAILED)
        ctx.add_warning("entity_profiling", "llm_error", f"Entity profiling failed: {e.detail}")
        ep_time, ws_time = None, None

    try:
        candidate_results, step2_time = _run_token_step(query, entity_profile, token_matcher)
        ctx.record_step("token_matching", StepStatus.SUCCESS, elapsed=step2_time)
    except Exception as e:
        logger.error("[PIPELINE] Token matching failed: %s — continuing with empty candidates", e)
        candidate_results = []
        ctx.record_step("token_matching", StepStatus.FAILED)
        ctx.add_warning("token_matching", "step_error", f"Token matching failed: {e}")

    try:
        ranking_llm_warnings = []
        llm_response, ranking_debug, step3_time = await _run_ranking_step(entity_profile, candidate_results, query, steps, params, llm_warnings=ranking_llm_warnings)
        if "llm_ranking" not in steps:
            ctx.record_step("llm_ranking", StepStatus.SKIPPED)
        else:
            for msg in ranking_llm_warnings:
                ctx.add_warning("llm_ranking", "llm_retry", msg)
            status = StepStatus.DEGRADED if ranking_llm_warnings else StepStatus.SUCCESS
            ctx.record_step("llm_ranking", status, elapsed=step3_time)
    except HTTPException as e:
        logger.error(
            "[PIPELINE] LLM ranking failed (%d: %s) — "
            "falling back to token match scores (%d candidates)",
            e.status_code, e.detail, len(candidate_results[:params["max_token_candidates"]]),
        )
        max_cands = params["max_token_candidates"]
        llm_response = {
            "ranked_candidates": [
                {"candidate": term, "relevance_score": score, "core_concept_score": score, "spec_score": 0}
                for term, score in candidate_results[:max_cands]
            ]
        }
        ranking_debug = {
            "inputs": {"token_matched_candidates": candidate_results[:max_cands]},
            "error": e.detail,
        }
        ctx.record_step("llm_ranking", StepStatus.FAILED)
        ctx.add_warning("llm_ranking", "llm_fallback", f"LLM ranking failed, using token scores: {e.detail}")

    # Log and persist
    training_record, api_response = _build_pipeline_results(
        ctx, llm_response, entity_profile, profile_debug,
        ranking_debug, candidate_results,
    )

    try:
        log_pipeline(training_record, session_id=user_id, trace_id=trace_id)
    except Exception as e:
        logger.error(f"[LANGFUSE] Failed to log: {e}")

    update_match_database(training_record)
    _update_session_usage(user_id, training_record["target"])

    return api_response


@router.post("/batches")
async def batch_start(
    request: Request,
    payload: Dict[str, Any] = Body(...)
) -> Dict[str, Any]:
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

    return success_response(
        message=f"Batch started: {item_count} items",
        data={"batch_id": batch_id}
    )


@router.patch("/batches/{batch_id}")
async def batch_complete(
    request: Request,
    batch_id: str,
    payload: Dict[str, Any] = Body(...)
) -> Dict[str, Any]:
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

    return success_response(
        message=f"Batch completed: {success_count}/{success_count + error_count} successful",
        data={"batch_id": batch_id, "success_count": success_count, "error_count": error_count}
    )


@router.post("/prompts")
async def direct_prompt(
    request: Request,
    payload: Dict[str, Any] = Body(...)
) -> Dict[str, Any]:
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
            system=system_prompt,
            output_format="json",
            temperature=dp_temperature,
            max_tokens=dp_max_tokens,
            model=dp_model,
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
        "llm_provider": LLM_PROVIDER, "direct_prompt_model": dp_model,
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

    return success_response(
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
from typing import Optional


class LogMatchRequest(BaseModel):
    """Request body for /log-match endpoint"""
    source: str                    # Original input term
    target: str                    # Matched result
    method: str                    # "cached" | "fuzzy"
    confidence: float              # 1.0 for cache, similarity score for fuzzy
    workbook_id: Optional[str] = None
    latency_ms: Optional[float] = None
    matched_key: Optional[str] = None      # Key that matched (fuzzy only)
    direction: Optional[str] = None        # "forward" | "reverse"


class LogActivityRequest(BaseModel):
    """Request body for /log-activity endpoint"""
    source: str
    target: str
    method: str                    # "UserChoice" | "DirectEdit"
    confidence: float
    timestamp: Optional[str] = None


@router.post("/activities/matches")
async def log_match(request: Request, payload: LogMatchRequest) -> Dict[str, Any]:
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

        return success_response(
            message=f"{payload.method} match logged",
            data={"trace_id": trace_id}
        )

    except Exception as e:
        logger.error(f"[LOG_MATCH] Error: {e}")
        return {"status": "error", "message": str(e)}


@router.post("/activities")
async def log_activity(request: Request, payload: LogActivityRequest) -> Dict[str, Any]:
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

        return success_response(
            message=f"{payload.method} logged",
            data={"success": success}
        )

    except Exception as e:
        logger.error(f"[LOG_ACTIVITY] Error: {e}")
        return {"status": "error", "message": str(e)}