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

# --- Logic from the second file ---

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

def research_and_rank_candidates(query, matcher, groq_api_key, verbose=False):
    """
    Main function: research topic, match candidates, get LLM ranking with string correction
    """
    # 1. Research
    entity_profile = web_generate_entity_profile(
        query,
        groq_api_key,
        max_sites=6,
        schema=entity_schema,
        content_char_limit=801,
        raw_content_limit=5000,
        verbose=verbose
    )

    # Extract and flatten values (excluding _metadata)
    values = [str(x) for k, v in entity_profile.items() if '_metadata' not in k
              for x in (v if isinstance(v, list) else [v])]
    query_list = [query] + values

    pprint(entity_profile)

    # 2. Match
    results, match_time = rank_terms_by_shared_tokens(matcher, query_list)

    print("DONE_______________________________")

    # 3. Format for LLM using display_profile
    profile_info = display_profile(entity_profile, "RESEARCH PROFILE")
    
    # 4. Get ranking
    ranking_result = call_llm_for_ranking(profile_info, results, query, groq_api_key)
    
    # 5. Correct candidate strings
    corrected_result = correct_candidate_strings(ranking_result, results)
    print("ACTUALLY I SUCCEEDED AT M JOBS")
    # pprint(corrected_result)
    return corrected_result

# --- Original logic from the upper file (API endpoint) ---

class ResearchAndMatchRequest(BaseModel):
    query: str

# Create router for research and ranking functionality
router = APIRouter()

@router.post("/research-and-match")
async def research_and_rank_candidates_endpoint(request: ResearchAndMatchRequest):
    """Research a query and rank candidates using web research + LLM ranking"""
    
    print(f"[RESEARCH-AND-MATCH] Query: '{request.query}'")
    
    # Get groq API key from environment
    groq_api_key = os.getenv("GROQ_API_KEY")
    if not groq_api_key:
        return {"error": "GROQ_API_KEY not found in environment"}
    
    # Import the global matcher from the token matcher module
    from .TokenLookupMatcher import token_matcher
    
    if token_matcher is None:
        print(f"[DEBUG] token_matcher is None - matcher not initialized")
        return {"error": "Matcher not initialized. Call /setup-matcher first."}
    
    try:
        # This now calls the function defined in this same file
        results = research_and_rank_candidates(request.query, token_matcher, groq_api_key, verbose=True)
    except Exception as e:
        print(f"[DEBUG] research_and_rank_candidates_endpoint called")
        print(f"[DEBUG] token_matcher is None: {token_matcher is None}")
        print(f"[DEBUG] Exception in research_and_rank_candidates: {e}")
        print(f"[DEBUG] Full traceback:")
        traceback.print_exc()
        return {"error": f"Research and ranking failed: {str(e)}"}
    
    # Handle the new dictionary structure and convert to expected format
    if isinstance(results, dict) and 'ranked_candidates' in results:
        ranked_candidates = results['ranked_candidates']
        print(f"[RESEARCH-AND-MATCH] Found {len(ranked_candidates)} matches")
        pprint(ranked_candidates)
        # Convert to the format expected by frontend: [[candidate, score], ...]
        formatted_matches = []
        
        if ranked_candidates:
            print(f"[RESEARCH-AND-MATCH] Top 3 matches:")
            for i, candidate_info in enumerate(ranked_candidates[:3]):
                candidate_name = candidate_info.get('candidate', 'Unknown')
                relevance_score = candidate_info.get('relevance_score', 0.0)
                print(f"[RESEARCH-AND-MATCH]   {i+1}. '{candidate_name}' (score: {relevance_score:.3f})")
            
            # Format all matches as [candidate, score] tuples
            for candidate_info in ranked_candidates:
                candidate_name = candidate_info.get('candidate', 'Unknown')
                relevance_score = candidate_info.get('relevance_score', 0.0)
                formatted_matches.append([candidate_name, relevance_score])
        else:
            print(f"[RESEARCH-AND-MATCH] No matches found")
        
        return {
            "query": request.query,
            "matches": formatted_matches,
            "total_matches": len(formatted_matches),
            "research_performed": True,
            "full_results": results
        }
    else:
        # Fallback for unexpected format
        print(f"[RESEARCH-AND-MATCH] Unexpected results format: {type(results)}")
        return {
            "query": request.query,
            "matches": [],
            "total_matches": 0,
            "research_performed": True
        }