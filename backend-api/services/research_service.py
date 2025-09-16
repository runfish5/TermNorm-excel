"""
Research and ranking service - contains business logic for research operations
"""
import json
import logging
import time
from pathlib import Path
from pprint import pprint
from collections import Counter
from fastapi import HTTPException

from models.matching_models import ResearchAndMatchRequest
from services.matching_service import get_matching_service
from research_and_rank.web_generate_entity_profile import web_generate_entity_profile
from research_and_rank.display_profile import display_profile
from research_and_rank.call_llm_for_ranking import call_llm_for_ranking
import utils.utils as utils
from utils.utils import CYAN, MAGENTA, RED, YELLOW, RESET

logger = logging.getLogger(__name__)


class ResearchService:
    """Service for research and ranking operations"""

    def __init__(self):
        # Load entity schema
        schema_path = Path(__file__).parent.parent / "research_and_rank" / "entity_profile_schema.json"
        with open(schema_path, 'r') as f:
            self.entity_schema = json.load(f)

    async def research_and_rank(self, request: ResearchAndMatchRequest) -> dict:
        """Research a query and rank candidates using LLM + token matching"""
        logger.info(f"[PIPELINE] Started for query: '{request.query}'")
        start_time = time.time()

        # Get matching service
        matching_service = get_matching_service()
        if matching_service.token_matcher is None:
            logger.error("[MISSING MAPPING INDEXES]")
            logger.error("TokenLookupMatcher not initialized. Configuration files need to be reloaded.")
            raise HTTPException(
                status_code=503,
                detail="Server restart detected - mapping indexes lost. Please reload your configuration files to restore mapping data."
            )

        # Step 1: Research
        logger.info("[PIPELINE] Step 1: Researching")
        entity_profile = await web_generate_entity_profile(
            request.query,
            max_sites=7,
            schema=self.entity_schema,
            verbose=True
        )
        pprint(entity_profile)

        # Step 2: Token matching
        logger.info("\n[PIPELINE] Step 2: Matching candidates")

        # Usage - direct replacement:
        search_terms = [request.query] + utils.flatten_strings(entity_profile)

        logger.info(f"LENGTH OF SEARCH TERMS: {len(search_terms)}")
        search_terms = [word for s in search_terms for word in s.split()]
        logger.info(f"(After) LENGTH OF SEARCH TERMS: {len(search_terms)}")
        logger.info(3*"\n>" + f">{'search_terms'}")
        word_counts = Counter(search_terms)
        logger.info("WORD COUNTS BEFORE SET:")
        for word, count in word_counts.most_common():
            logger.info(f"  '{word}': {count}")

        match_start = time.time()
        candidate_results = matching_service.token_matcher.match(list(set(search_terms)))

        logger.info(f"{RED}{chr(10).join([str(item) for item in candidate_results])}{RESET}")
        logger.info(f"Match completed in {time.time() - match_start:.2f}s")

        # Step 3: LLM ranking
        logger.info(CYAN + "\n[PIPELINE] Step 3: Ranking with LLM" + RESET)
        profile_info = display_profile(entity_profile, "RESEARCH PROFILE")

        response = await call_llm_for_ranking(profile_info, entity_profile, candidate_results, request.query)
        response['total_time'] = round(time.time() - start_time, 2)
        logger.info(YELLOW)
        logger.info(json.dumps(response, indent=2))
        logger.info(RESET)
        return response