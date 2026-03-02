"""Pipeline configuration and trace lifecycle endpoints."""
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional

from fastapi import APIRouter
from pydantic import BaseModel
from utils.responses import success_response
from utils.langfuse_logger import (
    create_trace, create_observation, create_score, update_trace,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["pipeline"])

PIPELINE_CONFIG_PATH = Path(__file__).parent.parent / "config" / "pipeline.json"


# =============================================================================
# GET /pipeline — Pipeline config
# =============================================================================

@router.get("/pipeline")
async def get_pipeline():
    """Return the complete pipeline configuration."""
    config = json.loads(PIPELINE_CONFIG_PATH.read_text())
    return success_response(
        message="Pipeline configuration",
        data=config,
    )


# =============================================================================
# POST /pipeline/trace — Create pipeline trace
# =============================================================================

class TraceRequest(BaseModel):
    query: str
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    pipeline_version: Optional[str] = None  # e.g. "v1.0" from frontend config


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
    return success_response(
        message="Trace created",
        data={"trace_id": trace_id},
    )


# =============================================================================
# POST /pipeline/steps — Report frontend step
# =============================================================================

class StepReport(BaseModel):
    trace_id: str
    step_name: str  # "cache_lookup" | "fuzzy_matching"
    result: Dict[str, Any]
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

    return success_response(message="Step reported")
