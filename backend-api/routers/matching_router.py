"""
Term matching router
"""
import logging
from fastapi import APIRouter, Depends

from models.matching_models import (
    UpdateMatcherRequest,
    MatchRequest,
    MatchResponse,
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


@router.post("/match-term", response_model=MatchResponse)
async def match_term(
    request: MatchRequest,
    matching_service: MatchingService = Depends(get_matching_service_instance)
):
    """Simple token-based matching without web research"""
    logger.info(f"Matching term: {request.query}")
    return await matching_service.match_term(request)


@router.post("/quick-match", response_model=MatchResponse)
async def quick_match(
    request: MatchRequest,
    matching_service: MatchingService = Depends(get_matching_service_instance)
):
    """Alias for match-term for backward compatibility"""
    logger.info(f"Quick match for: {request.query}")
    return await match_term(request, matching_service)