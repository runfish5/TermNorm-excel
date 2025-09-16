"""
Research and ranking router
"""
import logging
from fastapi import APIRouter, Depends

from models.matching_models import ResearchAndMatchRequest
from utils.exceptions import ApiResponse, handle_exceptions
from core.dependencies import get_research_service
from services.research_service import ResearchService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/research-and-match", response_model=ApiResponse)
@handle_exceptions
async def research_and_rank_candidates_endpoint(
    request: ResearchAndMatchRequest,
    research_service: ResearchService = Depends(get_research_service)
):
    """Research a query and rank candidates using LLM + token matching"""
    logger.info(f"Starting research and ranking for query: {request.query}")
    return await research_service.research_and_rank(request)