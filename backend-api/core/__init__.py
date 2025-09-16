"""
Core utilities for TermNorm Backend API - Ultra-lean for research-and-match core purpose
"""
from .logging import setup_logging, get_logger
from .dependencies import (
    get_matching_service_instance,
    get_research_service
)

__all__ = [
    "setup_logging",
    "get_logger",
    "get_matching_service_instance",
    "get_research_service",
]