"""
System API - Health checks, connection testing, and activity logging
"""
import logging
import json
import os
from datetime import datetime
from typing import Dict, Any, List
from fastapi import APIRouter, Body
from pathlib import Path

from config.environment import get_connection_info
from config.settings import settings
from core import llm_providers
from utils.responses import success_response
from utils.live_experiment_logger import log_to_experiments

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/")
def read_root() -> Dict[str, Any]:
    """API health check endpoint"""
    return {
        "status": "API running",
        "llm": f"{llm_providers.LLM_PROVIDER}/{llm_providers.LLM_MODEL}",
        "endpoints": ["/research-and-match", "/test-connection", "/log-activity"]
    }


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


@router.get("/llm-providers")
async def get_llm_providers() -> Dict[str, Any]:
    """Get available LLM providers and current configuration"""
    available_providers: List[str] = []

    if os.getenv("GROQ_API_KEY"):
        available_providers.append("groq")
    if os.getenv("OPENAI_API_KEY"):
        available_providers.append("openai")
    if os.getenv("ANTHROPIC_API_KEY"):
        available_providers.append("anthropic")

    return success_response(
        message="LLM providers retrieved",
        data={
            "available_providers": available_providers,
            "current_provider": llm_providers.LLM_PROVIDER,
            "current_model": llm_providers.LLM_MODEL
        }
    )


@router.post("/set-llm-provider")
async def set_llm_provider(payload: Dict[str, str] = Body(...)) -> Dict[str, Any]:
    """Set LLM provider and model (runtime configuration)"""
    provider = payload.get("provider")
    model = payload.get("model")

    if not provider or not model:
        return {"status": "error", "message": "Missing provider or model"}

    # Update environment variables and reload module
    os.environ["LLM_PROVIDER"] = provider
    os.environ["LLM_MODEL"] = model
    llm_providers.LLM_PROVIDER = provider
    llm_providers.LLM_MODEL = model

    logger.info(f"LLM provider changed to {provider}/{model}")
    return success_response(
        message=f"LLM provider set to {provider}",
        data={"provider": provider, "model": model}
    )


@router.post("/set-brave-api")
async def set_brave_api(payload: Dict[str, bool] = Body(...)) -> Dict[str, Any]:
    """Toggle Brave Search API usage (for testing fallbacks)"""
    enabled = payload.get("enabled", True)

    # Update runtime setting
    settings.use_brave_api = enabled

    logger.info(f"Brave API {'enabled' if enabled else 'disabled'}")
    return success_response(
        message=f"Brave API {'enabled' if enabled else 'disabled'}",
        data={"use_brave_api": enabled}
    )


@router.post("/set-web-search")
async def set_web_search(payload: Dict[str, bool] = Body(...)) -> Dict[str, Any]:
    """Toggle all web search engines (faster/cheaper when disabled)"""
    enabled = payload.get("enabled", True)

    # Update runtime setting
    settings.use_web_search = enabled

    logger.info(f"Web search {'enabled' if enabled else 'disabled'}")
    return success_response(
        message=f"Web search {'enabled' if enabled else 'disabled'}",
        data={"use_web_search": enabled}
    )


@router.post("/log-activity")
async def log_activity(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Log activity (e.g., UserChoice) to activity.jsonl and update match database"""
    source = payload.get("source")
    target = payload.get("target")
    method = payload.get("method", "UserChoice")
    confidence = payload.get("confidence", 1.0)
    timestamp = payload.get("timestamp") or datetime.utcnow().isoformat() + "Z"

    if not source or not target:
        return {"status": "error", "message": "source and target are required"}

    # Build record
    record = {
        "timestamp": timestamp,
        "source": source,
        "target": target,
        "method": method,
        "confidence": confidence
    }

    # DUAL LOGGING:
    # 1. Log to activity.jsonl (legacy)
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    with open(logs_dir / "activity.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")

    # 2. Log to experiments structure (NEW)
    try:
        trace_id = log_to_experiments(record)
        logger.info(f"[EXPERIMENTS] Logged to production_realtime, trace_id={trace_id}")
    except Exception as e:
        logger.error(f"[EXPERIMENTS] Failed to log: {e}")

    # Update match database
    from api.research_pipeline import update_match_database
    update_match_database(record)

    logger.info(f"[LOG] Activity logged: {source} -> {target} ({method})")
    return success_response(
        message="Activity logged",
        data={"source": source, "target": target, "method": method}
    )


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


@router.post("/rebuild-match-database")
async def rebuild_database() -> Dict[str, Any]:
    """Rebuild match database from activity.jsonl (admin use)"""
    from api.research_pipeline import rebuild_match_database

    count = rebuild_match_database()
    return success_response(
        message=f"Database rebuilt with {count} identifiers",
        data={"identifier_count": count}
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
    Manually trigger cache rebuild from experiments or activity.jsonl.

    Useful for forcing a refresh of the match_database.
    """
    from api.research_pipeline import rebuild_match_database

    identifiers_count = rebuild_match_database()

    return success_response(
        message=f"Cache rebuilt with {identifiers_count} identifiers",
        data={"identifiers": identifiers_count}
    )
