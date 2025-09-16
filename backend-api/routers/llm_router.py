"""
LLM term generation router
"""
import logging
from fastapi import APIRouter, Depends

from models.llm_models import InputData, OutputData, PromptTestResponse
from core.dependencies import get_llm_service
from services.llm_service import LLMService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/llm-generate-normalized-term", response_model=OutputData)
async def process_value_with_groq(
    input_data: InputData,
    llm_service: LLMService = Depends(get_llm_service)
):
    """Process input value using Groq LLM for term normalization"""
    logger.info(f"Processing term: {input_data.source_value}")
    return await llm_service.process_term(input_data)


@router.post("/test-prompt", response_model=PromptTestResponse)
async def test_prompt_generation(
    input_data: InputData,
    llm_service: LLMService = Depends(get_llm_service)
):
    """Test endpoint to see the generated prompt"""
    logger.info(f"Testing prompt generation for: {input_data.source_value}")
    return llm_service.test_prompt_generation(input_data)