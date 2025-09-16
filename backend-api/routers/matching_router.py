"""
Term matching router - ONLY /update-matcher endpoint
(Standalone matching is redundant - handled by research-and-match)
"""
import logging
from fastapi import APIRouter, Depends

from models.matching_models import (
    UpdateMatcherRequest,
    UpdateMatcherResponse
)
from core.dependencies import get_matching_service_instance
from services.matching_service import MatchingService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/update-matcher", response_model=UpdateMatcherResponse)
async def update_matcher(
    request: UpdateMatcherRequest,
    matching_service: MatchingService = Depends(get_matching_service_instance)
):
    """Smart endpoint that creates new matcher or appends to existing one"""
    logger.info(f"Updating matcher with {len(request.terms)} terms")
    return await matching_service.update_matcher(request)