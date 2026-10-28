"""Pipeline configuration and trace lifecycle endpoints."""
import copy
import logging
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from config.pipeline_config import get_pipeline_config
from core.llm_providers import llm_spend_bound
from research_and_rank.web_generate_entity_profile import web_spend_bound
from utils.langfuse_logger import (
    create_trace, create_observation, create_score, update_trace,
    _log_event, get_or_create_item,
)
from utils.schema_registry import get_schema_registry
from utils.prompt_registry import get_prompt_registry
from api.responses import _ok

logger = logging.getLogger(__name__)
router = APIRouter(tags=["pipeline"])


# =============================================================================
# GET /pipeline — Pipeline config
# =============================================================================

def _enrich_with_registries(config: dict) -> None:
    """Resolve schema and prompt registry references into top-level dicts.

    Scans nodes for ``schema_family``/``schema_version`` and
    ``prompt_family``/``prompt_version`` references, resolves them via
    the registries, and adds ``resolved_schemas`` and ``resolved_prompts``
    as top-level keys on ``config``.  Node configs are NOT modified.
    """
    schema_reg = get_schema_registry()
    prompt_reg = get_prompt_registry()

    resolved_schemas: dict[str, dict] = {}
    resolved_prompts: dict[str, dict] = {}

    for node in config.get("nodes", {}).values():
        nc = node.get("config", {})

        if sf := nc.get("schema_family"):
            sv = nc.get("schema_version")
            key = f"{sf}/{sv}" if sv is not None else sf
            if key not in resolved_schemas:
                try:
                    json_schema = schema_reg.get_schema(sf, sv)
                    meta = schema_reg.get_metadata(sf, sv)
                    resolved_schemas[key] = {
                        "family": sf,
                        "version": meta.get("version", sv),
                        "description": meta.get("description", ""),
                        "fields": meta.get("fields", []),
                        "json_schema": json_schema,
                    }
                except FileNotFoundError:
                    logger.debug("Schema not found: %s v%s", sf, sv)

        if pf := nc.get("prompt_family"):
            pv = nc.get("prompt_version")
            key = f"{pf}/{pv}" if pv is not None else pf
            if key not in resolved_prompts:
                try:
                    template = prompt_reg.get_prompt(pf, pv)
                    meta = prompt_reg.get_metadata(pf, pv)
                    resolved_prompts[key] = {
                        "family": pf,
                        "version": meta.get("version", pv),
                        "description": meta.get("description", ""),
                        "template_variables": meta.get("template_variables", []),
                        "fields": prompt_reg.get_fields(pf, pv),
                        "template": template,
                    }
                except FileNotFoundError:
                    logger.debug("Prompt not found: %s v%s", pf, pv)

    if resolved_schemas:
        config["resolved_schemas"] = resolved_schemas
    if resolved_prompts:
        config["resolved_prompts"] = resolved_prompts


def _attach_spend_bounds(config: dict) -> None:
    """Stamp ``spend_bound`` — the most one run of the node can bill — on every node that bills.

    Computed from the same loaded config ``/matches`` resolves node configs from, through the
    same readers its call sites enforce, so the served bound cannot drift from the enforced one.
    """
    for name, node in config["nodes"].items():
        if node["type"] == "llm":
            node["spend_bound"] = llm_spend_bound(node["config"])
        elif name == "web_search":
            node["spend_bound"] = web_spend_bound(node["config"])


@router.get("/pipeline")
async def get_pipeline():
    """Return the complete pipeline configuration with resolved registry references."""
    config = copy.deepcopy(get_pipeline_config())
    _attach_spend_bounds(config)
    _enrich_with_registries(config)
    return _ok(
        message="Pipeline configuration",
        data=config,
    )


# =============================================================================
# POST /pipeline/trace — Create pipeline trace
# =============================================================================

class TraceRequest(BaseModel):
    query: str
    session_id: str | None = None
    user_id: str | None = None
    pipeline_version: str | None = None  # e.g. "v1.0" from frontend config


@router.post("/pipeline/trace")
async def create_pipeline_trace(req: TraceRequest):
    """Create a pipeline trace. Returns trace_id for step reporting."""
    metadata = {"method": "pending"}
    if req.pipeline_version:
        metadata["pipeline_version"] = req.pipeline_version
    trace_id = create_trace(
        name="termnorm_pipeline",
        input={"query": req.query},
        user_id=req.user_id or "anonymous",
        session_id=req.session_id,
        metadata=metadata,
        tags=["production"],
    )
    return _ok(
        message="Trace created",
        data={"trace_id": trace_id},
    )


# =============================================================================
# POST /pipeline/steps — Report frontend step
# =============================================================================

class StepReport(BaseModel):
    trace_id: str
    step_name: str  # "cache_lookup" | "fuzzy_matching"
    result: dict[str, Any]
    latency_ms: float = 0


@router.post("/pipeline/steps")
async def report_pipeline_step(report: StepReport):
    """Report a frontend pipeline step result as an observation on an existing trace."""
    create_observation(
        trace_id=report.trace_id,
        type="span",
        name=report.step_name,
        input={"query": report.result.get("source", "")},
        output=report.result,
    )

    # If this step produced a final result, finalize the trace
    if report.result.get("target") and report.result.get("method") and report.result["method"] != "miss":
        create_score(report.trace_id, "confidence", report.result.get("confidence", 0))
        if report.latency_ms:
            create_score(report.trace_id, "latency_ms", report.latency_ms)
        update_trace(report.trace_id, output={
            "target": report.result["target"],
            "method": report.result["method"],
            "confidence": report.result.get("confidence", 0),
        }, metadata={"method": report.result["method"]})

        # Log event and dataset item (replaces what /activities/matches would have done)
        query = report.result.get("source", "")
        item_id = get_or_create_item(query, source_trace_id=report.trace_id) if query else None
        _log_event({
            "event": "pipeline",
            "trace_id": report.trace_id,
            "item_id": item_id,
            "query": query,
            "target": report.result["target"],
            "method": report.result["method"],
            "confidence": report.result.get("confidence", 0),
            "latency_ms": report.latency_ms,
        })

    return _ok(message="Step reported")
