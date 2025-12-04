# ./backend-api/research_and_rank/call_llm_for_ranking.py
from core.llm_providers import llm_call, LLM_PROVIDER, LLM_MODEL
from .correct_candidate_strings import correct_candidate_strings
import random
from utils.prompt_registry import get_prompt_registry

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
    """Rank candidates using LLM and return (result, debug_info) tuple"""

    # matches = "\n".join(f"- {term}" for i, (term, score) in enumerate(match_results[:20]))
    available_results = list(match_results[:20])
    sample_size = min(len(available_results), 20)  
    random_20 = random.sample(available_results, sample_size) if available_results else []
    matches = "\n".join(f"- {term}" for term, score in random_20)
    core_concept = entity_profile["core_concept"]
    
    # Get prompt from registry
    registry = get_prompt_registry()
    import json as json_lib
    entity_profile_json = json_lib.dumps(entity_profile, indent=2)
    
    prompt = registry.render_prompt(
        family="llm_ranking",
        version=1,  # Explicit version for reproducibility
        query=query,
        core_concept=core_concept,
        entity_profile_json=entity_profile_json,
        matches=matches
    )
    
    enhanced_prompt = f"""{prompt}

IMPORTANT: Return a valid JSON response matching this exact structure:
{{
  "profile_summary": "Brief 1-2 sentence summary of the profile",
  "core_concept_description": "What the core concept fundamentally is",
  "ranked_candidates": [
    {{
      "candidate": "exact candidate string",
      "core_concept_score": 0.0,
      "spec_score": 0.0,
      "evaluation_reasoning": "Brief explanation without quotes or backslashes",
      "key_match_factors": ["factor1", "factor2"],
      "spec_gaps": ["gap1", "gap2"]
    }}
  ]
}}

Ensure all strings are properly escaped and avoid complex punctuation in reasoning."""

    ranking_result = await llm_call(
        messages=[{"role": "user", "content": enhanced_prompt}],
        temperature=0,
        max_tokens=4000,
        output_format="json"  # Use json mode instead of schema
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

        result = {
            "query": query,
            "total_matches": len(candidates),
            "research_performed": True,
            "ranked_candidates": candidates,
            "llm_provider": f"{LLM_PROVIDER}/{LLM_MODEL}",
        }
        debug_info = {"inputs": {"token_matched_candidates": match_results[:20]}}
        return result, debug_info

    print(f"[WARNING] Unexpected results format: {type(corrected)}")
    result = {
        "query": query,
        "total_matches": 0,
        "research_performed": True,
        "ranked_candidates": [],
        "llm_provider": f"{LLM_PROVIDER}/{LLM_MODEL}",
    }
    debug_info = {"inputs": {"token_matched_candidates": match_results[:20]}}
    return result, debug_info