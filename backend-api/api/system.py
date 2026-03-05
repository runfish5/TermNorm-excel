"""
System API - Health checks, connection testing, and activity logging
"""
import logging
import os
from typing import Dict, Any, List
from fastapi import APIRouter, Body

from config.environment import get_connection_info
from config.pipeline_config import get_pipeline_config
from config.settings import settings
from core import llm_providers
from services import match_database as match_db
from utils.responses import success_response, error_response
from utils.standards_logger import ExperimentManager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
async def health() -> Dict[str, Any]:
    """Health check endpoint - returns server status and environment info"""
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


@router.get("/status")
async def status() -> Dict[str, Any]:
    """Status endpoint — returns current server state for external tools.

    Public (no auth required). Aggregates session, match DB, experiment,
    and pipeline info into a single snapshot.
    """
    from api.research_pipeline import user_sessions

    db = match_db.get_db()
    experiments = ExperimentManager().list_experiments()

    # Count total mappings across all experiments (with per-experiment breakdown)
    mappings_count = 0
    experiment_details: List[Dict[str, Any]] = []
    for exp in experiments:
        exp_id = exp["experiment_id"]
        mappings_path = (
            ExperimentManager().base_path / exp_id / "mappings.tsv"
        )
        exp_mappings = 0
        if mappings_path.exists():
            # Subtract 1 for header row
            exp_mappings = max(0, sum(1 for _ in open(mappings_path)) - 1)
        mappings_count += exp_mappings
        experiment_details.append({"id": exp_id, "mappings": exp_mappings})

    pipeline_cfg = get_pipeline_config()
    pipeline_version = pipeline_cfg.get("version", "unknown")

    return success_response(
        message="Server status",
        data={
            "session_active": len(user_sessions) > 0,
            "active_sessions": len(user_sessions),
            "terms_loaded": sum(
                len(s.get("terms", [])) for s in user_sessions.values()
            ),
            "match_database_identifiers": len(db),
            "match_database_aliases": sum(
                len(entry.get("aliases", {})) for entry in db.values()
            ),
            "experiments_count": len(experiments),
            "mappings_count": mappings_count,
            "experiments": experiment_details,
            "pipeline_version": pipeline_version,
            "llm_provider": llm_providers.LLM_PROVIDER,
            "llm_model": llm_providers.LLM_MODEL,
        }
    )


@router.get("/settings")
async def get_settings() -> Dict[str, Any]:
    """Get all runtime settings and available providers"""
    return success_response(
        message="Settings retrieved",
        data={
            "available_providers": llm_providers.get_available_providers(),
            "current_provider": llm_providers.LLM_PROVIDER,
            "current_model": llm_providers.LLM_MODEL,
            "brave_api_enabled": settings.use_brave_api
        }
    )


@router.put("/settings")
async def update_settings(payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Update runtime settings (idempotent, partial updates supported)"""
    updated = {}

    if "provider" in payload and "model" in payload:
        os.environ["LLM_PROVIDER"] = payload["provider"]
        os.environ["LLM_MODEL"] = payload["model"]
        llm_providers.LLM_PROVIDER = payload["provider"]
        llm_providers.LLM_MODEL = payload["model"]
        updated["provider"] = payload["provider"]
        updated["model"] = payload["model"]
        logger.info(f"LLM provider changed to {payload['provider']}/{payload['model']}")

    if "brave_api" in payload:
        settings.use_brave_api = payload["brave_api"]
        updated["brave_api"] = payload["brave_api"]
        logger.info(f"Brave API {'enabled' if payload['brave_api'] else 'disabled'}")

    if not updated:
        return error_response("No valid settings provided")

    return success_response(message="Settings updated", data=updated)


@router.get("/matches/{identifier}")
async def get_match_details(identifier: str) -> Dict[str, Any]:
    """Fetch match details from match_database by identifier (target)"""
    db = match_db.get_db()

    if not db:
        return error_response("Match database not loaded")

    entry = db.get(identifier)
    if not entry:
        return error_response(f"No entry found for identifier: {identifier}")

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


@router.get("/history")
async def get_processed_entries() -> Dict[str, Any]:
    """Return aggregated match history for frontend cache.

    Used by frontend on server reconnection to populate history view
    with previously processed matches (source->target mappings with profiles).
    """
    db = match_db.get_db()

    return success_response(
        message=f"Retrieved {len(db)} processed entries",
        data={"entries": db}
    )

@router.get("/cache")
async def get_cache_status() -> Dict[str, Any]:
    """
    Get sophisticated cache metadata status.

    Returns information about:
    - Which experiments/runs are loaded in cache
    - When cache was last updated
    - Total identifiers and aliases
    - Data sources and freshness
    """
    db = match_db.get_db()

    return success_response(
        message="Cache status retrieved",
        data={
            "match_database": {
                "identifiers": len(db),
                "aliases": sum(len(entry["aliases"]) for entry in db.values()),
            },
            "cache_metadata": match_db.get_cache_metadata().get_summary(),
        }
    )


@router.post("/cache/rebuild")
async def rebuild_cache() -> Dict[str, Any]:
    """
    Manually trigger cache rebuild from langfuse logs.

    Useful for forcing a refresh of the match_database.
    """
    identifiers_count = match_db.rebuild()

    return success_response(
        message=f"Cache rebuilt with {identifiers_count} identifiers",
        data={"identifiers": identifiers_count}
    )
