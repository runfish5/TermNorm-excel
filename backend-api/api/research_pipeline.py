"""
Research Pipeline API - /research-and-match endpoint with embedded orchestration logic
"""
import json
import logging
import time
from pathlib import Path
from pprint import pprint
from collections import Counter
from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Request, Body

from api.matcher_setup import get_token_matcher
from research_and_rank.web_generate_entity_profile import web_generate_entity_profile
from research_and_rank.display_profile import display_profile
from research_and_rank.call_llm_for_ranking import call_llm_for_ranking
import utils.utils as utils
from utils.utils import CYAN, MAGENTA, RED, YELLOW, RESET

logger = logging.getLogger(__name__)
router = APIRouter()

# Load entity schema once at module level
_schema_path = Path(__file__).parent.parent / "research_and_rank" / "entity_profile_schema.json"
with open(_schema_path, 'r') as f:
    ENTITY_SCHEMA = json.load(f)


@router.post("/research-and-match")
async def research_and_match(request: Request, payload: Dict[str, str] = Body(...)) -> Dict[str, Any]:
    """Research a query and rank candidates using LLM + token matching"""
    user_id = request.state.user_id
    query = payload.get("query", "")
    logger.info(f"[PIPELINE] User {user_id}: Started for query: '{query}'")
    start_time = time.time()

    # Get user's token matcher
    token_matcher = get_token_matcher(user_id)
    if token_matcher is None:
        logger.error(f"[MISSING MAPPING INDEXES] User {user_id}: TokenLookupMatcher not initialized")
        raise HTTPException(
            status_code=503,
            detail="Matcher not initialized - reload configuration files"
        )

    # Step 1: Research
    logger.info("[PIPELINE] Step 1: Researching")
    entity_profile = await web_generate_entity_profile(
        query,
        max_sites=7,
        schema=ENTITY_SCHEMA,
        verbose=True
    )
    pprint(entity_profile)

    # Step 2: Token matching
    logger.info("\n[PIPELINE] Step 2: Matching candidates")

    # Build search terms from query and entity profile
    search_terms = [word for s in [query] + utils.flatten_strings(entity_profile) for word in s.split()]
    unique_search_terms = list(set(search_terms))

    logger.info(f"Search terms: {len(search_terms)} total → {len(unique_search_terms)} unique")
    logger.info(f"Unique terms: {', '.join(unique_search_terms[:20])}{'...' if len(unique_search_terms) > 20 else ''}")

    match_start = time.time()
    candidate_results = token_matcher.match(unique_search_terms)

    logger.info(f"{RED}{chr(10).join([str(item) for item in candidate_results])}{RESET}")
    logger.info(f"Match completed in {time.time() - match_start:.2f}s")

    # Step 3: LLM ranking
    logger.info(CYAN + "\n[PIPELINE] Step 3: Ranking with LLM" + RESET)
    profile_info = display_profile(entity_profile, "RESEARCH PROFILE")

    response = await call_llm_for_ranking(profile_info, entity_profile, candidate_results, query)
    total_time = round(time.time() - start_time, 2)
    response['total_time'] = total_time

    # Add success status message for frontend
    num_candidates = len(response.get('ranked_candidates', []))
    response['status_message'] = f"✅ Research completed - Found {num_candidates} matches in {total_time}s"

    logger.info(YELLOW)
    logger.info(json.dumps(response, indent=2))
    logger.info(RESET)
    return response