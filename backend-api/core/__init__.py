"""
Core utilities for TermNorm Backend API
"""
from .logging import setup_logging, get_logger
from .dependencies import (
    get_groq_client,
    get_llm_service,
    get_pattern_service,
    get_matching_service_instance,
    get_research_service
)

__all__ = [
    "setup_logging",
    "get_logger",
    "get_groq_client",
    "get_llm_service",
    "get_pattern_service",
    "get_matching_service_instance",
    "get_research_service",
]