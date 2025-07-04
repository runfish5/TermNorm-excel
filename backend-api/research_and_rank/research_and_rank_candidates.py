import os
import traceback
from pydantic import BaseModel
from fastapi import APIRouter
from .research_and_rank import research_and_rank_candidates
from pprint import pprint
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