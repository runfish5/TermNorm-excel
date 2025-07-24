# ./backend-api/research_and_rank/call_llm_for_ranking.py
from research_and_rank.llm_providers import llm_call
from .correct_candidate_strings import correct_candidate_strings

GREEN = '\033[92m'
RESET = '\033[0m'

RANKING_SCHEMA = {
    "type": "object",
    "properties": {
        "ranked_candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "candidate": {"type": "string"},
                    "relevance_score": {"type": "number"},
                    "evaluation_reasoning": {"type": "string"},
                    "key_match_factors": {"type": "array", "items": {"type": "string"}},
                    "spec_gaps": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["candidate", "relevance_score", "evaluation_reasoning", "key_match_factors"]
            }
        }
    },
    "required": ["ranked_candidates"]
}

async def call_llm_for_ranking(profile_info, entity_profile, match_results, query):
    """Rank candidates using LLM and return standardized structure"""
    
    matches = "\n".join(f"{i+1}. {term}" for i, (term, score) in enumerate(match_results[:20]))
    core_concept = entity_profile["core_concept"]
    
    prompt = f"""You are a candidate evaluation expert specializing in semantic alignment assessment.

TASK: Filter and score candidates based on alignment with core concept and specifications.

PROCESS:
1. Filter out completely irrelevant candidates
2. Filter out candidates categorically different from core concept type
3. Identify key specifications from the profile to evaluate against
4. Score remaining candidates (0-10) with detailed assessment

QUERY: {query}
CORE CONCEPT: {core_concept}

PROFILE SPECIFICATIONS:
{profile_info}

CANDIDATES:
{matches}

OUTPUT: For each relevant candidate, provide score and explain alignment strengths/issues. Focus on core concept match first, then specification fit."""

    print(GREEN + prompt + RESET)
    
    ranking_result = await llm_call(
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
        max_tokens=2000,
        output_format="schema",
        schema=RANKING_SCHEMA
    )
    
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
        }
    
    print(f"[WARNING] Unexpected results format: {type(corrected)}")
    return {
        "query": query,
        "total_matches": 0,
        "research_performed": True,
        "ranked_candidates": [],
    }