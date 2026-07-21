"""Frontend telemetry endpoints — cache/fuzzy match + user-correction logging to Langfuse.

Fire-and-forget routes the frontend calls after a cache/fuzzy match or a user correction.
Split out of ``research_pipeline``: these have their own request models and are independent
of the /matches pipeline and the session store.
"""
import logging
from typing import Any
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from core.log_format import TAG_PIPE
from utils.langfuse_logger import log_cache_match, log_fuzzy_match, log_user_correction
from api.responses import _ok

logger = logging.getLogger(__name__)

router = APIRouter()


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

        logger.info(f"{TAG_PIPE} log-match {payload.method}: {payload.source[:30]}... -> {payload.target[:30]}... ({trace_id})")

        return _ok(
            message=f"{payload.method} match logged",
            data={"trace_id": trace_id}
        )

    except HTTPException:
        raise  # the explicit 400 (unknown method) keeps its status, not flattened to a 200
    except Exception as e:
        logger.error(f"{TAG_PIPE} log-match error: {e}")
        raise HTTPException(500, f"log-match failed: {e}")


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

        logger.info(f"{TAG_PIPE} log-activity {payload.method}: {payload.source[:30]}... -> {payload.target[:30]}...")

        return _ok(
            message=f"{payload.method} logged",
            data={"success": success}
        )

    except Exception as e:
        logger.error(f"{TAG_PIPE} log-activity error: {e}")
