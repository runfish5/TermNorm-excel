"""
Dependency injection utilities for TermNorm Backend API
"""
from typing import Generator
from fastapi import Depends, Request
from services.llm_service import LLMService
from services.pattern_service import PatternService
from services.matching_service import MatchingService, get_matching_service
from services.research_service import ResearchService


def get_groq_client(request: Request):
    """Get Groq client from app state"""
    return request.app.state.groq_client


def get_llm_service(groq_client = Depends(get_groq_client)) -> LLMService:
    """Dependency to get LLM service"""
    return LLMService(groq_client)


def get_pattern_service(groq_client = Depends(get_groq_client)) -> PatternService:
    """Dependency to get pattern analysis service"""
    return PatternService(groq_client)


def get_matching_service_instance() -> MatchingService:
    """Dependency to get matching service instance"""
    return get_matching_service()


def get_research_service() -> ResearchService:
    """Dependency to get research service"""
    return ResearchService()


# Optional: Database session dependency (for future use)
def get_db_session():
    """Database session dependency - placeholder for future implementation"""
    # db = SessionLocal()
    # try:
    #     yield db
    # finally:
    #     db.close()
    pass