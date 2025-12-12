"""
TermNorm API endpoints - Standard FastAPI structure
"""
from .research_pipeline import router as research_router
from .system import router as system_router
from .experiments_api import router as experiments_router

__all__ = [
    "research_router",
    "system_router",
    "experiments_router",
]