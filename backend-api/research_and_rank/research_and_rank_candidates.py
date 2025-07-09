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
from .correct_candidate_strings import correct_candidate_strings

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
    1. Web Research -> 2. Candidate Matching -> 3. LLM Ranking -> 4. String Correction
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

        # --- PIPELINE STEP 3: Format for LLM & Rank ---
        print("\n[PIPELINE] Step 3: Ranking with LLM")
        profile_info = display_profile(entity_profile, "RESEARCH PROFILE")
        ranking_result = call_llm_for_ranking(profile_info, candidate_results, request.query, groq_api_key)
        
        # --- PIPELINE STEP 4: Correct Candidate Strings ---
        print("\n[PIPELINE] Step 4: Correcting candidate strings")
        final_results = correct_candidate_strings(ranking_result, candidate_results)
        
    except Exception as e:
        print(f"[ERROR] Pipeline failed during execution: {e}")
        traceback.print_exc()
        return {"error": f"Research and ranking pipeline failed: {str(e)}"}
    
    # --- Formatting a successful response ---
    if isinstance(final_results, dict) and 'ranked_candidates' in final_results:
        ranked_candidates = final_results['ranked_candidates']
        print(f"\n[PIPELINE] Success! Found {len(ranked_candidates)} matches.")
        
        formatted_matches = [
            [c.get('candidate', 'Unknown'), c.get('relevance_score', 0.0)]
            for c in ranked_candidates
        ]
        
        # Log top 3 matches for clarity
        for i, candidate in enumerate(formatted_matches[:3]):
            print(f"  {i+1}. '{candidate[0]}' (score: {candidate[1]:.3f})")

        return {
            "query": request.query,
            "matches": formatted_matches,
            "total_matches": len(formatted_matches),
            "research_performed": True,
            "full_results": final_results
        }
    else:
        # Fallback for unexpected format from the pipeline
        print(f"[WARNING] Unexpected results format: {type(final_results)}")
        return {
            "query": request.query,
            "matches": [],
            "total_matches": 0,
            "research_performed": True
        }