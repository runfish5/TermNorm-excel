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

async def call_llm_for_ranking(profile_info, entity_profile, match_results, query):
    """Rank candidates using LLM and return standardized structure"""
    
    # Build prompt directly
    matches = "\n".join(f"{i+1}. {term}" for i, (term, score) in enumerate(match_results[:20]))
    core_concept = entity_profile["core_concept"]
    domain_instructions = ""
    prompt = f"""STEP 1: CORE CONCEPT EVALUATION (PRIMARY FACTOR - 70% WEIGHT)
First, evaluate which candidates best align with the core concept: "{core_concept}"
The core_concept represents the fundamental intent - all other profile terms are modifying specifiers.

STEP 2: IDENTIFY KEY SPECIFICATIONS FROM PROFILE  
Extract specifications and requirements from the research profile below.

STEP 3: RANK CANDIDATES
Rank based on core concept alignment first, then specification matching.

QUERY: {query}
CORE CONCEPT: {core_concept}

SPECIFYING TERMS:
{profile_info}

CANDIDATE MATCHES:
{matches}

INSTRUCTIONS:
1. FIRST: Evaluate semantic alignment with core concept "{core_concept}" 
2. SECOND: Identify key specifications mentioned in the profile
3. THIRD: Rank candidates prioritizing core concept match over specification details

RANKING APPROACH:
- Strong core concept alignment + exact specifications = highest priority
- Strong core concept alignment + partial specifications = high priority  
- Weak core concept alignment + exact specifications = medium priority
- Poor core concept alignment = lowest priority

{domain_instructions}

For each candidate, provide core_concept_alignment_score (0-10) and justify why it matches the fundamental concept."""

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