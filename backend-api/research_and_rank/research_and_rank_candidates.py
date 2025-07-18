import os
import traceback
import json
import time
from pathlib import Path
from pprint import pprint

from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

from utils.exceptions import handle_exceptions, ApiResponse
from .web_generate_entity_profile import web_generate_entity_profile
from .display_profile import display_profile
from research_and_rank.call_llm_for_ranking import call_llm_for_ranking

# Load entity schema
schema_path = Path(__file__).parent / "entity_profile_schema.json"
with open(schema_path, 'r') as f:
    entity_schema = json.load(f)

def rank_terms_by_shared_tokens(matcher, query):
    """Helper function for matching"""
    start = time.time()
    results = matcher.match(query)
    match_time = time.time() - start
    return results, match_time

# --- API Endpoint and Pipeline Logic ---

class ResearchAndMatchRequest(BaseModel):
    query: str

router = APIRouter()

@router.post("/research-and-match", response_model=ApiResponse)
@handle_exceptions
async def research_and_rank_candidates_endpoint(request: ResearchAndMatchRequest):
    """
    Research a query and rank candidates using a sequential pipeline:
    1. Web Research -> 2. Candidate Matching -> 3. LLM Ranking, Correction & Formatting
    """
    print(f"[PIPELINE] Started for query: '{request.query}'")
    
    # --- Setup ---
    from .TokenLookupMatcher import token_matcher
    if token_matcher is None:
        raise HTTPException(status_code=503, detail="Matcher not initialized. Call /setup-matcher first.")
        
    # Pipeline execution - no try-catch needed, decorator handles it
    print("[PIPELINE] Step 1: Researching")
    entity_profile = await web_generate_entity_profile(
        query=request.query,
        max_sites=6,
        schema=entity_schema,
        verbose=True
    )
    pprint(entity_profile)
    
    values = [str(x) for k, v in entity_profile.items() if '_metadata' not in k
              for x in (v if isinstance(v, list) else [v])]
    query_list = [request.query] + values

    print("\n[PIPELINE] Step 2: Matching candidates")
    candidate_results, match_time = rank_terms_by_shared_tokens(token_matcher, query_list)
    print(f"Match completed in {match_time:.2f}s")
    pprint(candidate_results)
    print("\n[PIPELINE] Step 3: Ranking with LLM")
    profile_info = display_profile(entity_profile, "RESEARCH PROFILE")
    
    final_response = await call_llm_for_ranking(
        profile_info, 
        candidate_results, 
        request.query
    )
    pprint(final_response)
    return final_response