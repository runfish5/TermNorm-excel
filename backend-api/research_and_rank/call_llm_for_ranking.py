# ./backend-api/research_and_rank/call_llm_for_ranking.py
from research_and_rank.llm_providers import llm_call
from .correct_candidate_strings import correct_candidate_strings

GREEN = '\033[92m'
RESET = '\033[0m'

# Simple schema - move complex nested structure to constant
RANKING_SCHEMA = {
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

async def call_llm_for_ranking(profile_info, match_results, query):
    """Rank candidates using LLM and return standardized structure"""
    
    # Build prompt directly
    matches = "\n".join(f"{i+1}. {term} (Score: {score:.3f})" for i, (term, score) in enumerate(match_results[:20]))
    
    domain_instructions = ""
    prompt = f"""STEP 1: IDENTIFY KEY SPECIFICATIONS FROM PROFILE
First, extract the key specifications and requirements from the research profile below.

QUERY: {query}

RESEARCH PROFILE:
{profile_info}

CANDIDATE MATCHES:
{matches}

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

    print(GREEN + prompt + RESET)
    
    # Call LLM
    ranking_result = await llm_call(
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
        max_tokens=2000,
        output_format="schema",
        schema=RANKING_SCHEMA
    )
    
    # Correct and return
    print("\n[PIPELINE] Step 4: Correcting candidate strings")
    corrected = correct_candidate_strings(ranking_result, match_results)
    
    if corrected and 'ranked_candidates' in corrected:
        candidates = corrected['ranked_candidates']
        print(f"\n[PIPELINE] Success! Found {len(candidates)} matches.")
        
        for i, c in enumerate(candidates[:3]):
            print(f"  {i+1}. '{c.get('candidate', 'Unknown')}' (score: {c.get('relevance_score', 0.0):.3f})")
        
        return {
            "query": query,
            "total_matches": len(candidates),
            "research_performed": True,
            "ranked_candidates": candidates,
            "profile_specs_identified": corrected.get('profile_specs_identified', []),
            "ranking_explanation": corrected.get('ranking_explanation', {})
        }
    
    print(f"[WARNING] Unexpected results format: {type(corrected)}")
    return {
        "query": query,
        "total_matches": 0,
        "research_performed": True,
        "ranked_candidates": [],
        "profile_specs_identified": [],
        "ranking_explanation": {}
    }