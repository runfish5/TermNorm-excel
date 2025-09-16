"""
Pattern analysis router
"""
import logging
from fastapi import APIRouter, Request, Depends

from models.pattern_models import PatternRequest, PatternDiscoveryResult
from core.dependencies import get_pattern_service
from services.pattern_service import PatternService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/analyze-patterns", response_model=PatternDiscoveryResult)
async def analyze_patterns(
    request_data: PatternRequest,
    request: Request,
    pattern_service: PatternService = Depends(get_pattern_service)
):
    """Iteratively analyze dictionary patterns with intelligent pattern discovery"""
    logger.info(f"Starting pattern analysis for project: {request_data.project_name}")
    return await pattern_service.analyze_patterns(request_data, request)