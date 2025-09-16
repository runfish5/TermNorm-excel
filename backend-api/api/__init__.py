"""
TermNorm API endpoints - Standard FastAPI structure
"""
from .matcher_setup import router as matcher_router
from .research_pipeline import router as research_router
from .system import router as system_router

__all__ = [
    "matcher_router",
    "research_router",
    "system_router"
]