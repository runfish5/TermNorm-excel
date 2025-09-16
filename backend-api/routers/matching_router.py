"""
Term matching router - ONLY /update-matcher endpoint
(Standalone matching is redundant - handled by research-and-match)
"""
import logging
from typing import Dict, Any, List
from fastapi import APIRouter, Depends

from core.dependencies import get_matching_service_instance
from services.matching_service import MatchingService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/update-matcher")
async def update_matcher(
    request: Dict[str, List[str]],  # {"terms": ["term1", "term2", ...]}
    matching_service: MatchingService = Depends(get_matching_service_instance)
) -> Dict[str, Any]:
    """Smart endpoint that creates new matcher or appends to existing one"""
    terms = request.get("terms", [])
    logger.info(f"Updating matcher with {len(terms)} terms")
    return await matching_service.update_matcher({"terms": terms})