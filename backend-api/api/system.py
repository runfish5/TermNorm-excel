"""
System API - Health checks, connection testing, and activity logging
"""
import logging
import os
from typing import Dict, Any, List
from fastapi import APIRouter, Body

from config.environment import get_connection_info
from config.settings import settings
from core import llm_providers
from utils.responses import success_response

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/test-connection")
async def test_connection() -> Dict[str, Any]:
    """Test API connection and return environment info"""
    connection_type, connection_url, environment = get_connection_info()

    return success_response(
        message="Server online",
        data={
            "provider": llm_providers.LLM_PROVIDER,
            "connection_type": connection_type,
            "connection_url": connection_url,
            "environment": environment
        }
    )


@router.get("/settings")
async def get_settings() -> Dict[str, Any]:
    """Get all runtime settings and available providers"""
    available_providers: List[str] = []
    if os.getenv("GROQ_API_KEY"):
        available_providers.append("groq")
    if os.getenv("OPENAI_API_KEY"):
        available_providers.append("openai")
    if os.getenv("ANTHROPIC_API_KEY"):
        available_providers.append("anthropic")

    return success_response(
        message="Settings retrieved",
        data={
            "available_providers": available_providers,
            "current_provider": llm_providers.LLM_PROVIDER,
            "current_model": llm_providers.LLM_MODEL,
            "web_search_enabled": settings.use_web_search,
            "brave_api_enabled": settings.use_brave_api
        }
    )


@router.post("/settings")
async def update_settings(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Update runtime settings (partial updates supported)"""
    updated = {}

    if "provider" in payload and "model" in payload:
        os.environ["LLM_PROVIDER"] = payload["provider"]
        os.environ["LLM_MODEL"] = payload["model"]
        llm_providers.LLM_PROVIDER = payload["provider"]
        llm_providers.LLM_MODEL = payload["model"]
        updated["provider"] = payload["provider"]
        updated["model"] = payload["model"]
        logger.info(f"LLM provider changed to {payload['provider']}/{payload['model']}")

    if "web_search" in payload:
        settings.use_web_search = payload["web_search"]
        updated["web_search"] = payload["web_search"]
        logger.info(f"Web search {'enabled' if payload['web_search'] else 'disabled'}")

    if "brave_api" in payload:
        settings.use_brave_api = payload["brave_api"]
        updated["brave_api"] = payload["brave_api"]
        logger.info(f"Brave API {'enabled' if payload['brave_api'] else 'disabled'}")

    if not updated:
        return {"status": "error", "message": "No valid settings provided"}

    return success_response(message="Settings updated", data=updated)


@router.get("/match-details/{identifier}")
async def get_match_details(identifier: str) -> Dict[str, Any]:
    """Fetch match details from match_database by identifier (target)"""
    from api.research_pipeline import match_database

    if not match_database:
        return {"status": "error", "message": "Match database not loaded"}

    entry = match_database.get(identifier)
    if not entry:
        return {"status": "error", "message": f"No entry found for identifier: {identifier}"}

    return success_response(
        message="Match details retrieved",
        data={
            "identifier": identifier,
            "entity_profile": entry.get("entity_profile"),
            "aliases": entry.get("aliases", {}),
            "web_sources": entry.get("web_sources", []),
            "last_updated": entry.get("last_updated")
        }
    )


@router.get("/history/processed-entries")
async def get_processed_entries() -> Dict[str, Any]:
    """Return aggregated match history for frontend cache.

    Used by frontend on server reconnection to populate history view
    with previously processed matches (source→target mappings with profiles).
    """
    from api.research_pipeline import match_database

    return success_response(
        message=f"Retrieved {len(match_database)} processed entries",
        data={"entries": match_database}
    )

@router.get("/cache/status")
async def get_cache_status() -> Dict[str, Any]:
    """
    Get sophisticated cache metadata status.

    Returns information about:
    - Which experiments/runs are loaded in cache
    - When cache was last updated
    - Total identifiers and aliases
    - Data sources and freshness
    """
    from api.research_pipeline import match_database, cache_metadata

    cache_summary = cache_metadata.get_summary()

    return success_response(
        message="Cache status retrieved",
        data={
            "match_database": {
                "identifiers": len(match_database),
                "aliases": sum(len(entry["aliases"]) for entry in match_database.values()),
            },
            "cache_metadata": cache_summary,
        }
    )


@router.post("/cache/rebuild")
async def rebuild_cache() -> Dict[str, Any]:
    """
    Manually trigger cache rebuild from langfuse logs.

    Useful for forcing a refresh of the match_database.
    """
    from api.research_pipeline import rebuild_match_database

    identifiers_count = rebuild_match_database()

    return success_response(
        message=f"Cache rebuilt with {identifiers_count} identifiers",
        data={"identifiers": identifiers_count}
    )
