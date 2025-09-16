"""
Pydantic models for TermNorm Backend API - Ultra-lean for research-and-match core purpose
"""
from .common import ActivityLogEntry, HealthResponse, ConnectionTestResponse
from .matching_models import (
    UpdateMatcherRequest,
    MatchRequest,
    ResearchAndMatchRequest,
    MatchResponse,
    UpdateMatcherResponse
)

__all__ = [
    # Common models
    "ActivityLogEntry",
    "HealthResponse",
    "ConnectionTestResponse",
    # Matching models (core functionality)
    "UpdateMatcherRequest",
    "MatchRequest",
    "ResearchAndMatchRequest",
    "MatchResponse",
    "UpdateMatcherResponse",
]