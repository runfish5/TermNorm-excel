from research_and_rank.llm_providers import llm_call
import json

# Import the correction function, assuming it's in a sibling module
from .correct_candidate_strings import correct_candidate_strings

async def call_llm_for_ranking(profile_info, match_results, query):
    """
    Ranks candidates using an LLM, corrects the output strings,
    and formats the final successful API response.
    """
    ranking_schema = {
        "type": "object",
        "properties": {
            "profile_specs_identified": {"type": "array", "items": {"type": "string"}},
            "ranking_explanation": {
                "type": "object",
                "properties": {
                    "methodology": {"type": "string"},
                    "key_differentiators": {"type": "array", "items": {"type": "string"}},
                    "confidence_level": {"type": "string"}
                },
                "required": ["methodology", "key_differentiators", "confidence_level"]
            },
            "ranked_candidates": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "rank": {"type": "integer"},
                        "candidate": {"type": "string"},
                        "relevance_score": {"type": "number"},
                        "key_match_factors": {"type": "array", "items": {"type": "string"}},
                        "spec_gaps": {"type": "array", "items": {"type": "string"}}
                    },
                    "required": ["rank", "candidate", "relevance_score", "key_match_factors"]
                }
            }
        },
        "required": ["profile_specs_identified", "ranked_candidates", "ranking_explanation"]
    }
    
    match_list = "\n".join([f"{i+1}. {term} (Score: {score:.3f})" 
                            for i, (term, score) in enumerate(match_results[:20])])
    
    prompt = f"""STEP 1: IDENTIFY EXACT SPECIFICATIONS FROM PROFILE
First, extract the exact technical specifications from the research profile below.

QUERY: {query}

RESEARCH PROFILE:
{profile_info}

CANDIDATE MATCHES:
{match_list}

CRITICAL INSTRUCTIONS:
1. FIRST: Identify the exact Glass Fiber percentage specified in the profile (look for "Glass Fiber', 'specification': 'X%'")
2. SECOND: Identify the exact material type (PA66, PA6, etc.)
3. THIRD: Rank candidates based on EXACT specification matches

RANKING PRIORITY:
- Exact Glass Fiber % match = highest priority
- Exact material type match = second priority  
- Close matches = lower priority
- Mismatched specs = lowest priority

If profile shows 35% Glass Fiber, then "35% GF" candidates must rank higher than "25% GF" or "50% GF" candidates.

Provide the identified specs first, then ranking based on exact specification matching."""

    messages = [{"role": "user", "content": prompt}]
    
    ranking_result = await llm_call(
        messages=messages,
        temperature=0,
        max_tokens=2000,
        output_format="schema",
        schema=ranking_schema
    )
    
    # --- PIPELINE STEP 4: Correct Candidate Strings ---
    print("\n[PIPELINE] Step 4: Correcting candidate strings")
    final_results = correct_candidate_strings(ranking_result, match_results)
    
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
            "query": query,
            "total_matches": len(formatted_matches),
            "research_performed": True,
            "full_results": final_results
        }
    else:
        # Fallback for unexpected format from the pipeline
        print(f"[WARNING] Unexpected results format: {type(final_results)}")
        return {
            "query": query,
            "total_matches": 0,
            "research_performed": True
        }