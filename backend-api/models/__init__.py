"""
Pydantic models for TermNorm Backend API
"""
from .common import ActivityLogEntry, HealthResponse, ConnectionTestResponse
from .llm_models import InputData, OutputData, TransformationGroup, PromptTestResponse
from .pattern_models import PatternRequest, RuleCluster, PatternDiscoveryResult
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
    # LLM models
    "InputData",
    "OutputData",
    "TransformationGroup",
    "PromptTestResponse",
    # Pattern models
    "PatternRequest",
    "RuleCluster",
    "PatternDiscoveryResult",
    # Matching models
    "UpdateMatcherRequest",
    "MatchRequest",
    "ResearchAndMatchRequest",
    "MatchResponse",
    "UpdateMatcherResponse",
]