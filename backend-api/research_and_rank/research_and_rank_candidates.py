# ./backend-api/research_and_rank/research_and_rank_candidates.py
import json
import logging
import time
from pathlib import Path
from pprint import pprint
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException
from utils.exceptions import handle_exceptions, ApiResponse
from .web_generate_entity_profile import web_generate_entity_profile
from .display_profile import display_profile
from research_and_rank.call_llm_for_ranking import call_llm_for_ranking
from collections import Counter
from utils.utils import CYAN, MAGENTA, RED, YELLOW, RESET
import utils.utils as utils

# Load entity schema
schema_path = Path(__file__).parent / "entity_profile_schema.json"
with open(schema_path, 'r') as f:
    entity_schema = json.load(f)

class ResearchAndMatchRequest(BaseModel):
    query: str

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/research-and-match", response_model=ApiResponse)
@handle_exceptions
async def research_and_rank_candidates_endpoint(request: ResearchAndMatchRequest):
    """Research a query and rank candidates using LLM + token matching"""
    print(f"[PIPELINE] Started for query: '{request.query}'")
    start_time = time.time()
    
    from .TokenLookupMatcher import token_matcher
    if token_matcher is None:
        logger.error(f"[MISSING MAPPING INDEXES]")
        logger.error("TokenLookupMatcher not initialized. Configuration files need to be reloaded.")
        raise HTTPException(status_code=503, detail="Server restart detected - mapping indexes lost. Please reload your configuration files to restore mapping data.")
    
    # Step 1: Research
    print("[PIPELINE] Step 1: Researching")
    entity_profile = await web_generate_entity_profile(
        request.query,
        max_sites=7,
        schema=entity_schema,
        verbose=True
    )
    pprint(entity_profile)
    
    # Step 2: Token matching
    print("\n[PIPELINE] Step 2: Matching candidates")

    # Usage - direct replacement:
    search_terms = [request.query] + utils.flatten_strings(entity_profile)
    
    print(f"LENGTH OF SEARCH TERMS: {len(search_terms)}")
    search_terms = [word for s in search_terms for word in s.split()]
    print(f"(After) LENGTH OF SEARCH TERMS: {len(search_terms)}")
    print(3*"\n>" + f">{'search_terms'}")
    word_counts = Counter(search_terms)
    print(f"WORD COUNTS BEFORE SET:")
    for word, count in word_counts.most_common():
        print(f"  '{word}': {count}")

    match_start = time.time()
    candidate_results = token_matcher.match(list(set(search_terms)))

    print(f"{RED}{'\n'.join([str(item) for item in candidate_results])}{RESET}")
    print(f"Match completed in {time.time() - match_start:.2f}s")
    # Step 3: LLM ranking
    
    print(CYAN + "\n[PIPELINE] Step 3: Ranking with LLM" + RESET)
    profile_info = display_profile(entity_profile, "RESEARCH PROFILE")
    
    response = await call_llm_for_ranking(profile_info, entity_profile, candidate_results, request.query)
    response['total_time'] = round(time.time() - start_time, 2)
    print(YELLOW)
    print(json.dumps(response, indent=2))
    print(RESET)
    return response