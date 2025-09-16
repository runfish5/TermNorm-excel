"""
Business logic services for TermNorm Backend API - Ultra-lean for research-and-match core purpose
"""
from .matching_service import MatchingService, get_matching_service
from .research_service import ResearchService

__all__ = [
    "MatchingService",
    "get_matching_service",
    "ResearchService",
]