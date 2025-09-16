"""
Health check and system status router
"""
import logging
from fastapi import APIRouter
from pathlib import Path

from models.common import HealthResponse, ConnectionTestResponse, ActivityLogEntry
from config.environment import get_connection_info
from research_and_rank.llm_providers import LLM_PROVIDER, LLM_MODEL

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/", response_model=HealthResponse)
def read_root():
    """API health check endpoint"""
    return HealthResponse(
        status="API running",
        llm=f"{LLM_PROVIDER}/{LLM_MODEL}",
        endpoints=["/match-term", "/research-and-match", "/quick-match", "/test-connection"]
    )


@router.post("/test-connection", response_model=ConnectionTestResponse)
async def test_connection():
    """Test API connection and return environment info"""
    connection_type, connection_url, environment = get_connection_info()

    return ConnectionTestResponse(
        status="OK",
        provider=LLM_PROVIDER,
        connection_type=connection_type,
        connection_url=connection_url,
        environment=environment
    )


@router.post("/log-activity")
async def log_activity(entry: ActivityLogEntry):
    """Log activity entry to file"""
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    with open(logs_dir / "activity.jsonl", "a", encoding="utf-8") as f:
        f.write(entry.model_dump_json() + "\n")
    return {"status": "logged"}