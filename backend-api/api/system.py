"""
System API - Health checks, connection testing, and activity logging
"""
import logging
import json
from typing import Dict, Any
from fastapi import APIRouter
from pathlib import Path

from config.environment import get_connection_info
from core.llm_providers import LLM_PROVIDER, LLM_MODEL
from utils.responses import success_response

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/")
def read_root() -> Dict[str, Any]:
    """API health check endpoint"""
    return {
        "status": "API running",
        "llm": f"{LLM_PROVIDER}/{LLM_MODEL}",
        "endpoints": ["/update-matcher", "/research-and-match", "/test-connection", "/log-activity"]
    }


@router.post("/test-connection")
async def test_connection() -> Dict[str, Any]:
    """Test API connection and return environment info"""
    connection_type, connection_url, environment = get_connection_info()

    return success_response(
        message="Server online",
        data={
            "provider": LLM_PROVIDER,
            "connection_type": connection_type,
            "connection_url": connection_url,
            "environment": environment
        }
    )


@router.post("/log-activity")
async def log_activity(entry: Dict[str, Any]) -> Dict[str, str]:
    """Log activity entry to file"""
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)

    with open(logs_dir / "activity.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")

    return success_response(message="Activity logged")