"""
Dependency injection utilities for TermNorm Backend API - Ultra-lean for research-and-match core purpose
"""
from services.matching_service import MatchingService, get_matching_service
from services.research_service import ResearchService


def get_matching_service_instance() -> MatchingService:
    """Dependency to get matching service instance"""
    return get_matching_service()


def get_research_service() -> ResearchService:
    """Dependency to get research service"""
    return ResearchService()