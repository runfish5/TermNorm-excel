import os
import traceback
import json
import time
from pathlib import Path
from pprint import pprint

from pydantic import BaseModel
from fastapi import APIRouter

# Assuming these modules are in the same directory or a discoverable path
from .web_generate_entity_profile import web_generate_entity_profile
from .display_profile import display_profile
from .call_llm_for_ranking import call_llm_for_ranking
# The import for correct_candidate_strings is no longer needed here

# --- Configuration and Helpers ---

# Load entity schema
schema_path = Path(__file__).parent / "entity_profile_schema.json"
with open(schema_path, 'r') as f:
    entity_schema = json.load(f)

def rank_terms_by_shared_tokens(matcher, query):
    """Helper function for matching"""
    start = time.time()
    results = matcher.match(query)  # Returns ALL matches
    match_time = time.time() - start
    return results, match_time

# --- API Endpoint and Pipeline Logic ---

class ResearchAndMatchRequest(BaseModel):
    query: str

# Create router for research and ranking functionality
router = APIRouter()

@router.post("/research-and-match")
async def research_and_rank_candidates_endpoint(request: ResearchAndMatchRequest):
    """
    Research a query and rank candidates using a sequential pipeline:
    1. Web Research -> 2. Candidate Matching -> 3. LLM Ranking, Correction & Formatting
    """
    print(f"[PIPELINE] Started for query: '{request.query}'")
    
    # --- Setup ---
    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        return {"error": "GROQ_API_KEY not found in environment"}
        
    # Import the global matcher from the token matcher module
    from .TokenLookupMatcher import token_matcher
    if token_matcher is None:
        print("[ERROR] Matcher not initialized. Call /setup-matcher first.")
        return {"error": "Matcher not initialized. Call /setup-matcher first."}
        
    try:
        # --- PIPELINE STEP 1: Research ---
        print("[PIPELINE] Step 1: Researching")
        entity_profile = web_generate_entity_profile(
            request.query,
            groq_api_key,
            max_sites=6,
            schema=entity_schema,
            verbose=True
        )
        pprint(entity_profile)
        
        # Flatten profile values for the next step
        values = [str(x) for k, v in entity_profile.items() if '_metadata' not in k
                  for x in (v if isinstance(v, list) else [v])]
        query_list = [request.query] + values

        # --- PIPELINE STEP 2: Match ---
        print("\n[PIPELINE] Step 2: Matching candidates")
        candidate_results, match_time = rank_terms_by_shared_tokens(token_matcher, query_list)
        print(f"Match completed in {match_time:.2f}s")

        # --- PIPELINE STEP 3 & 4: Rank, Correct & Format ---
        print("\n[PIPELINE] Step 3: Ranking with LLM (includes correction and formatting)")
        profile_info = display_profile(entity_profile, "RESEARCH PROFILE")
        
        # This function now handles the remaining steps and returns the final API response
        final_response = call_llm_for_ranking(
            profile_info, 
            candidate_results, 
            request.query, 
            groq_api_key
        )
        
        return final_response
            
    except Exception as e:
        print(f"[ERROR] Pipeline failed during execution: {e}")
        traceback.print_exc()
        return {"error": f"Research and ranking pipeline failed: {str(e)}"}