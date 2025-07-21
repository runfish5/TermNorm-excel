from research_and_rank.llm_providers import llm_call
import json

# Import the correction function, assuming it's in a sibling module
from .correct_candidate_strings import correct_candidate_strings

GREEN = '\033[92m'
YELLOW = '\033[93m'
RESET = '\033[0m'

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
    domain_instructions = ""
    prompt = f"""STEP 1: IDENTIFY KEY SPECIFICATIONS FROM PROFILE
First, extract the key specifications and requirements from the research profile below.

QUERY: {query}

RESEARCH PROFILE:
{profile_info}

CANDIDATE MATCHES:
{match_list}

INSTRUCTIONS:
1. FIRST: Identify the key specifications mentioned in the profile
2. SECOND: Identify any specific requirements or constraints
3. THIRD: Rank candidates based on how well they match the identified specifications

RANKING APPROACH:
- Exact specification matches = highest priority
- Close specification matches = medium priority
- Partial matches = lower priority
- Poor matches = lowest priority

{domain_instructions}

Provide the identified specifications first, then ranking based on specification matching and relevance to the query."""

    print(GREEN + prompt +RESET)
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