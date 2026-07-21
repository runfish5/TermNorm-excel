"""/matches response builder — the ONE envelope shape for every terminal node.

``build_response`` turns a settled PipelineContext into ``(training_record, api_response)``,
keyed on which node the pipeline stopped at (llm_only / fuzzy / full ranker). ``_response_data``
is the single field layout every terminal shares, so a consumer (PromptPotter) reads one stable
shape and never special-cases on node count. Split out of ``research_pipeline`` so response
building is its own module, separate from dispatch.
"""
from typing import Any

from core.pipeline_context import PipelineContext, StepStatus
from api.responses import _ok
from api.pipeline_steps import NODE_OUTPUT_SERIALIZERS


def _response_data(
    ctx: PipelineContext,
    ranked: list[dict],
    *,
    entity_profile: Any = None,
    candidate_ranking: list | None = None,
    web_status: str | None = None,
    web_error: str | None = None,
    web_cost: dict | None = None,
    node_outputs: dict | None = None,
    providers: dict | None = None,
) -> dict:
    """The ONE ``/matches`` response shape — identical fields for a single-node
    (``llm_only``), a fuzzy-only, and a full multi-node pipeline.

    ``final_ranking == []`` is the SOLE NO_RESULT signal. The enrichment fields
    (entity profile, candidate ranking, web status/cost, node outputs) default to
    empty/None for a pipeline that never ran retrieval, web search, or ranking —
    so the consumer (PromptPotter) reads one stable shape and never special-cases
    on node count or on a field being absent versus empty."""
    data = {
        "final_ranking": ranked,
        "entity_profile": entity_profile if entity_profile is not None else [],
        "candidate_ranking": candidate_ranking if candidate_ranking is not None else [],
        "total_time": ctx.total_time,
        "step_timings": ctx.step_timings,
        "step_tokens": ctx.step_tokens,
        "web_search_status": web_status,
        "web_search_error": web_error,
        "web_cost": web_cost if web_cost is not None else {},
        "node_outputs": node_outputs if node_outputs is not None else {},
        "pipeline_params": {
            "steps": ctx.executed_steps,
            "requested_steps": ctx.requested_steps,
            **ctx.params,
        },
        "terminated_at": ctx.terminated_at,
        "diagnostics": ctx.build_diagnostics(),
    }
    if providers:
        data.update(providers)
    return data


def build_response(ctx: PipelineContext) -> tuple:
    """Build ``(training_record, api_response)`` from PipelineContext outputs.

    ONE envelope shape for every terminal node, keyed on which node the pipeline
    stopped at. Only the full ranker pipeline produces a ``training_record`` for
    match-DB / langfuse persistence; the single-node (``llm_only``) and
    fuzzy-only terminals return ``None`` there — there is no candidate matched
    against the session term library to persist."""
    terminal = ctx.terminated_at

    if terminal == "llm_only":
        out = ctx.get_output("llm_only") or {}
        data = _response_data(ctx, out.get("final_ranking", []))
        # Model chain-of-thought (reasoning models only; head-capped at source).
        # PromptPotter's critique tier reads it to diagnose per-sample failures.
        data["reasoning_trace"] = out.get("reasoning_trace", "")
        return None, _ok(
            message=f"LLM-only completed in {ctx.total_time}s",
            data=data,
        )

    if terminal == "fuzzy_matching":
        fuzzy = ctx.get_output("fuzzy_matching") or []
        ranked = [{"candidate": t, "relevance_score": s} for t, s in fuzzy]
        return None, _ok(
            message=f"Fuzzy matching completed - {len(ranked)} matches in {ctx.total_time}s",
            data=_response_data(ctx, ranked),
        )

    # Full ranker pipeline — entity profile + token candidates + LLM ranking.
    entity_profile = ctx.get_output("entity_profiling") or []
    llm_response = ctx.get_output("llm_ranking") or {}
    candidates = ctx.get_output("token_matching") or []
    profile_debug = ctx.get_output("_profile_debug", {"inputs": {"scraped_sources": {"status": "skipped"}}})
    ranking_debug = ctx.get_output("_ranking_debug")

    ranked = llm_response.get("ranked_candidates", [])
    # No ranked candidate == NO_RESULT (final_ranking == []); the match-DB record
    # carries an explicit None target rather than a "No matches found" sentinel.
    target = ranked[0].get("candidate") if ranked else None
    confidence = ranked[0].get("relevance_score", 0) if ranked else 0

    # Three-state web_search_status
    scraped_sources = profile_debug["inputs"]["scraped_sources"]
    if scraped_sources.get("status") in ("skipped", "precomputed"):
        web_status, web_error, web_sources = scraped_sources["status"], None, []
    elif "error" in scraped_sources:
        web_status, web_error, web_sources = "failed", scraped_sources["error"], []
    else:
        web_status, web_error = "success", None
        web_sources = scraped_sources.get("sources_fetched", [])

    # Per-match cost + reliability (strategy, metered brave_queries, scrape stats,
    # evidence_chars) — PromptPotter weighs this against accuracy to pick the
    # "most efficiently true" web_search strategy. See WEB_SEARCH_STRATEGY.md.
    web_cost = profile_debug.get("web_cost", {})

    ep_cfg = ctx.params.get("entity_profiling", {})
    lr_cfg = ctx.params.get("llm_ranking", {})
    providers = {
        "profiling_provider": ep_cfg.get("provider"),
        "profiling_model": ep_cfg.get("model"),
        "ranking_provider": lr_cfg.get("provider"),
        "ranking_model": lr_cfg.get("model"),
    }

    training_record = {
        "source": ctx.query, "target": target, "method": "ProfileRank",
        "confidence": confidence, "session_id": ctx.user_id,
        **providers,
        "total_time": ctx.total_time, "web_search_status": web_status, "error": web_error,
        "step_timings": ctx.step_timings,
        "step_tokens": ctx.step_tokens,
        "pipeline_params": {
            "steps": ctx.executed_steps,
            "requested_steps": ctx.requested_steps,
            **ctx.params,
        },
        "entity_profile": entity_profile,
        "candidates": [
            {"rank": i, "name": c.get("candidate"), "score": c.get("relevance_score"),
             "core_score": c.get("core_concept_score"), "spec_score": c.get("spec_score")}
            for i, c in enumerate(ranked)
        ] if ranked else [],
        "token_matches": ranking_debug["inputs"]["candidate_ranking"] if ranking_debug else [],
        "web_sources": web_sources,
        "web_cost": web_cost,
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

    candidate_ranking = candidates[: ctx.params["token_matching"]["max_token_candidates"]]
    api_response = _ok(
        message=f"Research completed - Found {len(ranked)} matches in {ctx.total_time}s",
        data=_response_data(
            ctx, ranked,
            entity_profile=entity_profile,
            candidate_ranking=candidate_ranking,
            web_status=web_status, web_error=web_error, web_cost=web_cost,
            node_outputs=node_outputs, providers=providers,
        ),
    )
    return training_record, api_response
