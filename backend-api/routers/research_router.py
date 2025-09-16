"""
Research and ranking router
"""
import logging
from typing import Dict, Any
from fastapi import APIRouter, Depends

from utils.exceptions import ApiResponse, handle_exceptions
from core.dependencies import get_research_service
from services.research_service import ResearchService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/research-and-match", response_model=ApiResponse)
@handle_exceptions
async def research_and_rank_candidates_endpoint(
    request: Dict[str, str],  # {"query": "search term"}
    research_service: ResearchService = Depends(get_research_service)
):
    """Research a query and rank candidates using LLM + token matching"""
    query = request.get("query", "")
    logger.info(f"Starting research and ranking for query: {query}")
    return await research_service.research_and_rank({"query": query})