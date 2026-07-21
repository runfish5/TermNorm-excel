"""Pipeline step library — the node implementations behind the /matches dispatch loop.

Each ``_step_*`` has the uniform ``(query, cfg, ctx) -> StepResult`` signature the
dispatcher in ``research_pipeline`` calls via ``STEP_REGISTRY``. The ``_run_*`` helpers
hold the actual work; the ``_step_*`` wrappers adapt it to the PipelineContext and the
warning taxonomy. Serializers/deserializers here define the node-output wire shape used
for partial-pipeline caching. Split out of ``research_pipeline`` so the dispatch endpoint,
the session store, and the step library are each their own module.
"""
import json
import logging
import time
from typing import Callable, Any
from fastapi import HTTPException

from research_and_rank.web_generate_entity_profile import web_generate_entity_profile
from research_and_rank.call_llm_for_ranking import call_llm_for_ranking
from research_and_rank.fuzzy_matching import fuzzy_match_terms
from research_and_rank.token_matcher import TokenLookupMatcher
from core.llm_providers import llm_call
from core.log_format import TAG_PIPE
from core.pipeline_context import (
    PipelineContext, StepResult, StepStatus, StepWarning, WarningKind, http_status_warning,
)
import utils.utils as utils
from utils.schema_registry import append_structure_directive, get_schema_registry
from config.pipeline_config import get_node_config, get_session_required_steps

logger = logging.getLogger(__name__)

# Entity schema (versioned, pinned to pipeline.json config) — used by _run_research_step.
_schema_registry = get_schema_registry()
_ep_schema_cfg = get_node_config("entity_profiling")
ENTITY_SCHEMA = _schema_registry.get_schema(
    _ep_schema_cfg["schema_family"],
    _ep_schema_cfg.get("schema_version"),
)


def _run_fuzzy_step(query: str, terms: list[str], fm_cfg: dict) -> tuple:
    """Step 0: Fuzzy matching. Returns (results, elapsed_time)."""
    logger.info(f"{TAG_PIPE} Step 0: Fuzzy matching")
    t0 = time.time()
    results = fuzzy_match_terms(
        query, terms, threshold=fm_cfg["threshold"], scorer=fm_cfg["scorer"], limit=fm_cfg["limit"]
    )
    elapsed = round(time.time() - t0, 3)
    logger.info(f"{TAG_PIPE} Fuzzy: {len(results)} matches in {elapsed}s")
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
        logger.info(f"{TAG_PIPE} Step 1: Skipping entity profiling")
        profile_debug = {"inputs": {"scraped_sources": {"status": "skipped", "note": "Skipped by pipeline steps"}}}
        return [], profile_debug, None, None

    if scraped_content is not None:
        logger.info(f"{TAG_PIPE} Step 1: Researching (precomputed web content)")
    else:
        logger.info(f"{TAG_PIPE} Step 1: Researching" + (" (LLM knowledge only)" if not run_web_search else ""))
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
    logger.debug("%s Entity profile: %s", TAG_PIPE, entity_profile)
    ep_time = profile_debug.get("llm_elapsed")
    ws_time = profile_debug.get("web_search_elapsed")
    return entity_profile, profile_debug, ep_time, ws_time


def _run_token_step(query: str, entity_profile: list, token_matcher: "TokenLookupMatcher") -> tuple:
    """Step 2: Token matching. Returns (candidate_results, elapsed_time)."""
    logger.info(f"{TAG_PIPE} Step 2: Matching candidates")
    search_terms = [word for s in [query] + utils.flatten_strings(entity_profile) for word in s.split()]
    unique_search_terms = list(set(search_terms))

    logger.debug(f"{TAG_PIPE} {len(unique_search_terms)} profile terms (from {len(search_terms)}): {', '.join(unique_search_terms[:20])}{'...' if len(unique_search_terms) > 20 else ''}")

    t0 = time.time()
    candidate_results = token_matcher.match(unique_search_terms)
    elapsed = round(time.time() - t0, 3)

    n = len(candidate_results)
    if n:
        top_name, top_score = candidate_results[0]
        bot_score = candidate_results[-1][1]
        logger.info(f"{TAG_PIPE} Token matches: {n} in {elapsed:.2f}s ({top_score:.3f}–{bot_score:.3f})  top: {top_name[:60]}... ({top_score:.3f})")
    else:
        logger.warning(f"{TAG_PIPE} Token matches: 0 candidates in {elapsed:.2f}s")
    return candidate_results, elapsed


def _token_scores_as_ranking(candidates: list, limit: int) -> dict:
    """Build a ``ranked_candidates`` payload from raw token-match scores.

    The shared fallback shape used whenever LLM ranking is skipped or fails: the
    token score doubles as relevance and core-concept score; spec score is
    unknown (0). One builder so the skip-ranking and ranking-exception paths
    cannot diverge.
    """
    return {
        "ranked_candidates": [
            {"candidate": term, "relevance_score": score, "core_concept_score": score, "spec_score": 0}
            for term, score in candidates[:limit]
        ]
    }


async def _run_ranking_step(entity_profile: list, candidates: list, query: str, steps: list[str], lr_cfg: dict, tm_cfg: dict, llm_warnings: list[str] | None = None, usage_out: dict | None = None) -> tuple:
    """Step 3: LLM ranking. Returns (llm_response, ranking_debug, elapsed_time).

    When *usage_out* is provided, it is populated with the LLM call's token
    usage (``{"input", "output"}``).
    """
    run_llm_ranking = "llm_ranking" in steps
    max_token_candidates = tm_cfg["max_token_candidates"]

    t0 = time.time()
    if not run_llm_ranking:
        logger.info(f"{TAG_PIPE} Step 3: Skipping LLM ranking (using token scores)")
        llm_response = _token_scores_as_ranking(candidates, max_token_candidates)
        ranking_debug = {"inputs": {"candidate_ranking": candidates[:max_token_candidates]}}
    else:
        logger.info(f"{TAG_PIPE} Step 3: Ranking with LLM")
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
        logger.error("%s Fuzzy matching failed: %s — continuing", TAG_PIPE, e)
        return StepResult(output=[], elapsed=0.0, status=StepStatus.FAILED,
                          warnings=[StepWarning("fuzzy_matching", "step_error", f"Fuzzy matching failed: {e}", WarningKind.STRUCTURAL)])

    # Determine if fuzzy is the last step — if so, terminate the pipeline. The
    # unified _build_response reads ctx output("fuzzy_matching") to shape the
    # terminal envelope; no side-channel response is stashed here.
    req = ctx.requested_steps
    fuzzy_idx = req.index("fuzzy_matching") if "fuzzy_matching" in req else -1
    is_last = fuzzy_idx == len(req) - 1

    return StepResult(output=results, elapsed=elapsed, terminates=is_last)


async def _step_web_search(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    """Sentinel — web search always runs inside _step_entity_profiling (coupled function), so
    this step is itself a no-op. web_search without entity_profiling is not a supported config."""
    return StepResult(output=None, elapsed=0.0, status=StepStatus.SKIPPED)


def _llm_failure_code(e: HTTPException) -> str:
    """Map a provider HTTPException to a distinct warning code keyed on its status.

    PromptPotter's degradation verdict classifies the failure from the CODE alone (no
    message parsing), so the code must carry the structural-vs-transient signal:
      * 429            -> ``rate_limited``  (transient — backend rate-limited, recoverable)
      * 5xx            -> ``server_error``  (transient — upstream outage / timeout)
      * 401/403/404    -> ``client_error``  (structural — auth / not-found, won't self-heal)
      * other 4xx      -> ``schema_invalid``(structural — json/schema/token-limit fault, the
                          deterministic-for-config break the optimizer must not re-propose)

    Mirrors PromptPotter's STRUCTURAL_/TRANSIENT_WARNING_CODES taxonomy. Replaces the old
    single ``llm_error`` code that forced the consumer to grep the free-text message.

    Delegates to the shared :func:`http_status_warning` taxonomy, overriding only the
    LLM-specific ``schema_invalid`` for other-4xx (json/schema/token-limit faults)."""
    status = getattr(e, "status_code", None)
    code, _ = http_status_warning(status)
    return "schema_invalid" if code == "upstream_error" else code


def _llm_failure_kind(e: HTTPException) -> WarningKind:
    """Structural vs transient for a provider HTTPException — keyed on status, in
    lockstep with :func:`_llm_failure_code` via the shared :func:`http_status_warning`
    taxonomy. 429 (rate-limited) and 5xx (upstream outage / timeout) are recoverable
    noise → transient; every other 4xx (auth, not-found, schema/json/token-limit fault)
    is a deterministic-for-config break the optimizer must not re-propose → structural."""
    _, kind = http_status_warning(getattr(e, "status_code", None))
    return kind


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
        # Surface warnings — web_search dicts carry their own source-stamped kind;
        # the llm retry/repair channel is recoverable noise → transient.
        for w in profile_debug.get("warnings", []):
            ctx.add_warning(w["step"], w["code"], w["message"], w["kind"], details=w.get("details"), stats=w.get("stats"))
        for msg in ep_llm_warnings:
            ctx.add_warning("entity_profiling", "llm_retry", msg, WarningKind.TRANSIENT)

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
        logger.warning("%s Entity profiling failed — continuing with token matching only", TAG_PIPE)
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
            warnings=[StepWarning("entity_profiling", _llm_failure_code(e), f"Entity profiling failed: {e.detail}", _llm_failure_kind(e))],
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
        logger.error("%s Token matching failed: %s — continuing with empty candidates", TAG_PIPE, e)
        return StepResult(output=[], elapsed=0.0, status=StepStatus.FAILED,
                          warnings=[StepWarning("token_matching", "step_error", f"Token matching failed: {e}", WarningKind.STRUCTURAL)])


async def _step_ranking(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    """LLM ranking — rank candidates using entity profile context."""
    entity_profile = ctx.get_output("entity_profiling") or []
    candidates = ctx.get_output("token_matching") or []
    lr_cfg = ctx.params.get("llm_ranking", {})
    tm_cfg = ctx.params.get("token_matching", {})

    if not candidates:
        logger.info("%s llm_ranking: no candidates — skipping", TAG_PIPE)
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

        warnings = [StepWarning("llm_ranking", "llm_retry", msg, WarningKind.TRANSIENT) for msg in ranking_llm_warnings]
        status = StepStatus.DEGRADED if ranking_llm_warnings else StepStatus.SUCCESS
        return StepResult(output=llm_response, elapsed=elapsed or 0.0, status=status, warnings=warnings)

    except HTTPException as e:
        max_cands = tm_cfg["max_token_candidates"]
        logger.error(
            "%s LLM ranking failed (%d: %s) — falling back to token match scores (%d candidates)",
            TAG_PIPE, e.status_code, e.detail, len(candidates[:max_cands]),
        )
        llm_response = _token_scores_as_ranking(candidates, max_cands)
        ranking_debug = {
            "inputs": {"candidate_ranking": candidates[:max_cands]},
            "error": e.detail,
        }
        ctx.set_output("_ranking_debug", ranking_debug)
        return StepResult(
            output=llm_response, elapsed=0.0, status=StepStatus.FAILED,
            warnings=[StepWarning("llm_ranking", "llm_fallback", f"LLM ranking failed, using token scores: {e.detail}", WarningKind.TRANSIENT)],
        )


async def _step_llm_only(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    """Generic LLM call — send prompt + query, get text response."""
    # Start line is emitted by llm_call() via node_name=, so no separate tag here.
    t0 = time.time()

    system = cfg.get("prompt", "")
    provider = cfg["provider"]
    model = cfg["model"]
    temperature = cfg["temperature"]
    max_tokens = cfg.get("max_tokens")
    response_format = cfg["response_format"]
    reasoning_effort = cfg.get("reasoning_effort")
    # `llm_call` has always accepted a seed; this node never passed one, so every dataset
    # pinning `seed: 0` (justlogic does) silently ran non-deterministic on this arm while
    # believing otherwise. A benchmark whose noise floor is only readable because it is
    # deterministic cannot have the key it declared dropped one frame from the provider.
    seed = cfg.get("seed")
    # The node's SECOND prompt. When declared, the answer arrives in a slot we named,
    # positioned, and described — instead of being regex-scraped out of prose.
    output_schema = cfg.get("output_schema")
    answer_field = cfg.get("answer_field")

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
    if output_schema:
        # `answer_field` names which slot IS the answer. Required, not defaulted: a hidden
        # default here would silently grade the wrong field (`CLAUDE.md`: no fallbacks in
        # service code), and hardcoding "answer" would bake a dataset's vocabulary into the
        # backend.
        if not answer_field:
            raise ValueError(
                "llm_only: `output_schema` is set but `answer_field` is not — "
                "declare which schema field carries the answer."
            )
        if answer_field not in (output_schema.get("properties") or {}):
            raise ValueError(
                f"llm_only: answer_field {answer_field!r} is not a property of output_schema "
                f"(have: {sorted((output_schema.get('properties') or {}))})"
            )
        # ONE declaration of the shape, feeding both the prompt block and the decoder, so the
        # two can never disagree — the same rule `call_llm_for_ranking` follows. The rendered
        # block is what TEACHES the field order and the enum value space; constrained decoding
        # only COMPELS them where the provider honors it.
        system = append_structure_directive(system, output_schema).lstrip()
        kwargs["output_format"] = "schema"
        kwargs["schema"] = output_schema
    elif response_format == "json":
        kwargs["output_format"] = "json"
    if system:
        kwargs["system"] = system
    if reasoning_effort is not None:
        kwargs["reasoning_effort"] = reasoning_effort
    if seed is not None:
        kwargs["seed"] = seed

    llm_only_usage: dict = {}
    response = await llm_call(**kwargs, usage_out=llm_only_usage, node_name="llm_only")
    if response is None:
        answer = ""
    elif output_schema:
        # Destructure the named slot. This is NOT pre-judging: the backend reads the field the
        # schema declares, the SCORING MATCHER still decides HIT/MISS. A response that omits
        # `answer_field` (or was never an object) leaves `answer` empty, which falls into the
        # existing structural NO_RESULT below — a schema violation is a non-result, never a
        # wrong answer.
        if isinstance(response, dict):
            value = response.get(answer_field, "")
            answer = value if isinstance(value, str) else json.dumps(value)
        else:
            logger.warning(
                "%s llm_only: schema declared but response decoded as %s — NO_RESULT",
                TAG_PIPE,
                type(response).__name__,
            )
            answer = ""
    elif isinstance(response, str):
        answer = response
    else:
        answer = response.get("output", json.dumps(response))
    elapsed = round(time.time() - t0, 3)
    # The model's chain-of-thought (reasoning models put it on message.reasoning,
    # not content). Popped BEFORE record_step_tokens so step_tokens stays numeric;
    # forwarded in the response envelope for PromptPotter's critique tier.
    reasoning_trace = llm_only_usage.pop("reasoning_text", "")
    ctx.record_step_tokens("llm_only", llm_only_usage)

    # The ``llm_call`` retry/repair/empty channel is recoverable noise → transient.
    # ``content_empty`` keeps its distinct code (PoBB's empty-response fast-path
    # reads it alongside the raw finish_reason shape from step_tokens); the rest
    # collapse to ``llm_retry`` rather than the old "code: message" re-split that
    # turned verbose repair lines into garbage codes.
    step_warnings: list[StepWarning] = []
    for w in call_warnings:
        if w.startswith("content_empty:"):
            step_warnings.append(StepWarning("llm_only", "content_empty", w.partition(": ")[2], WarningKind.TRANSIENT))
        else:
            step_warnings.append(StepWarning("llm_only", "llm_retry", w, WarningKind.TRANSIENT))
    if not answer.strip():
        logger.warning("%s llm_only: empty output after %ss", TAG_PIPE, elapsed)
        step_warnings.append(
            StepWarning("llm_only", "empty_output", "LLM returned empty content", WarningKind.TRANSIENT)
        )

    # An empty / declined answer is a structural NO_RESULT — final_ranking == []
    # (the SOLE no-result signal, shared with the multi-node path), NOT a
    # confident empty candidate at score 1.0. A non-empty answer passes through
    # raw at relevance_score 1.0: the SCORING MATCHER decides HIT/MISS, so the backend must
    # not pre-judge it. With an `output_schema` the answer is DESTRUCTURED from its named slot
    # first (reading a declared field is not judging it); a schema violation lands here as the
    # same structural NO_RESULT, never as a wrong answer. The unified
    # _build_response reads this output to shape the terminal envelope — no
    # _early_response side-channel, one response shape for every pipeline.
    stripped = answer.strip()
    final_ranking = (
        [{"candidate": stripped, "relevance_score": 1.0}] if stripped else []
    )
    return StepResult(
        output={"final_ranking": final_ranking, "reasoning_trace": reasoning_trace},
        elapsed=elapsed,
        terminates=True,
        status=StepStatus.SUCCESS if stripped else StepStatus.DEGRADED,
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
