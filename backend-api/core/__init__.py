"""
Core utilities for TermNorm Backend API - Ultra-lean for research-and-match core purpose
"""
from .logging import setup_logging, get_logger
from .dependencies import (
    get_matching_service_instance,
    get_research_service
)
from .llm_providers import llm_call, LLM_PROVIDER, LLM_MODEL

__all__ = [
    "setup_logging",
    "get_logger",
    "get_matching_service_instance",
    "get_research_service",
    "llm_call",
    "LLM_PROVIDER",
    "LLM_MODEL",
]