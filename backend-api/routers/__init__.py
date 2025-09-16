"""
FastAPI routers for TermNorm Backend API
"""
from .health_router import router as health_router
from .llm_router import router as llm_router
from .pattern_router import router as pattern_router
from .matching_router import router as matching_router
from .research_router import router as research_router

__all__ = [
    "health_router",
    "llm_router",
    "pattern_router",
    "matching_router",
    "research_router",
]