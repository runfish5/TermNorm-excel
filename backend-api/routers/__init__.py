"""
FastAPI routers for TermNorm Backend API - Ultra-lean for research-and-match core purpose
"""
from .health_router import router as health_router
from .matching_router import router as matching_router
from .research_router import router as research_router

__all__ = [
    "health_router",
    "matching_router",
    "research_router",
]