# ./backend-api/research_and_rank/call_llm_for_ranking.py
from research_and_rank.llm_providers import llm_call
from .correct_candidate_strings import correct_candidate_strings
import random

GREEN = '\033[92m'
RESET = '\033[0m'

RANKING_SCHEMA = {
    "type": "object",
    "properties": {
        "profile_summary": {"type": "string"},
        "core_concept_description": {"type": "string"},
        "ranked_candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "candidate": {"type": "string"},
                    "core_concept_score": {"type": "number"},
                    "spec_score": {"type": "number"},
                    "evaluation_reasoning": {"type": "string"},
                    "key_match_factors": {"type": "array", "items": {"type": "string"}},
                    "spec_gaps": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["candidate", "core_concept_score", "spec_score", "evaluation_reasoning", "key_match_factors"]
            }
        }
    },
    "required": ["profile_summary", "core_concept_description", "ranked_candidates"]
}

async def call_llm_for_ranking(profile_info, entity_profile, match_results, query):
    """Rank candidates using LLM and return standardized structure"""
    
    # matches = "\n".join(f"- {term}" for i, (term, score) in enumerate(match_results[:20]))
    random_20 = random.sample(list(match_results[:20]), 20)
    matches = "\n".join(f"- {term}" for term, score in random_20)
    core_concept = entity_profile["core_concept"]
    
    prompt = f"""You are a candidate evaluation expert.

TASK 1: Analyze profile and core concept (PRIMARY FACTOR - 70% WEIGHT)  
- Summarize the profile in 1-2 sentences capturing key details
- Describe what the core concept "{core_concept}" fundamentally is and identify its foundational category - this represents the fundamental intent, all other profile terms are modifying specifiers

TASK 2: Score each candidate (0-5 scale)
- Core concept score: semantic alignment with fundamental intent "{core_concept}" - candidates must match the same foundational category to score above 2
- Specification score: match with profile modifying specifiers
- Prioritize core concept alignment over specification details

CRITICAL: If core concept and candidate belong to different foundational categories (e.g. process vs material, object vs method), core concept score must be 0-2 regardless of relatedness. Match the core concept exactly as stated - do not add words or interpret it as a compound concept with additional terms.

### QUERY:
{query}
### CORE CONCEPT:
{core_concept}

## PROFILE:
{profile_info}

## CANDIDATES: 
{matches}

Evaluate semantic alignment with core concept "{core_concept}" first, then specification matching."""

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
            core_score = c.get('core_concept_score', 0.0)
            spec_score = c.get('spec_score', 0.0)
            print(f"  {i+1}. '{c.get('candidate', 'Unknown')}' (core: {core_score:.1f}, spec: {spec_score:.1f})")
        
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