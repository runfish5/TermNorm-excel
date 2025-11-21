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


@router.get("/match-details/{timestamp}")
async def get_match_details(timestamp: str) -> Dict[str, Any]:
    """Fetch detailed match info from activity.jsonl by timestamp"""
    logs_dir = Path("logs")
    activity_log = logs_dir / "activity.jsonl"

    if not activity_log.exists():
        return {"status": "error", "message": "Activity log not found"}

    # Read log file and find matching timestamp
    with open(activity_log, "r", encoding="utf-8") as f:
        for line in f:
            try:
                record = json.loads(line)
                if record.get("timestamp") == timestamp and record.get("method") == "ProfileRank":
                    # Return full record with entity profile, candidates, web sources
                    return success_response(
                        message="Match details retrieved",
                        data={
                            "source": record.get("source"),
                            "target": record.get("target"),
                            "confidence": record.get("confidence"),
                            "entity_profile": record.get("entity_profile"),
                            "candidates": record.get("candidates"),
                            "web_sources": record.get("web_sources"),
                            "token_matches": record.get("token_matches"),
                            "total_time": record.get("total_time"),
                            "llm_provider": record.get("llm_provider"),
                            "web_search_status": record.get("web_search_status")
                        }
                    )
            except json.JSONDecodeError:
                continue

    return {"status": "error", "message": "No matching record found"}