# ./backend-api/research_and_rank/call_llm_for_ranking.py
from core.llm_providers import llm_call, LLM_PROVIDER, LLM_MODEL
from .correct_candidate_strings import correct_candidate_strings
from prompts.prompt_loader import get_prompt_loader
import random
import logging

logger = logging.getLogger(__name__)

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

async def call_llm_for_ranking(profile_info, entity_profile, match_results, query, prompt_version="latest"):
    """Rank candidates using LLM and return (result, debug_info) tuple"""

    # matches = "\n".join(f"- {term}" for i, (term, score) in enumerate(match_results[:20]))
    available_results = list(match_results[:20])
    sample_size = min(len(available_results), 20)
    random_20 = random.sample(available_results, sample_size) if available_results else []
    matches = "\n".join(f"- {term}" for term, score in random_20)
    core_concept = entity_profile["core_concept"]

    # Load versioned prompt or use default
    try:
        prompt_loader = get_prompt_loader()
        prompt_data = prompt_loader.load_prompt('candidate_ranking', prompt_version)

        # Format main prompt
        prompt = prompt_loader.format_prompt(
            prompt_data,
            query=query,
            core_concept=core_concept,
            profile_info=profile_info,
            matches=matches
        )

        # Add JSON format instructions if available
        json_format = prompt_data.get('json_format_instruction', '')
        if json_format:
            enhanced_prompt = f"{prompt}\n\n{json_format}"
        else:
            enhanced_prompt = prompt

        print(f"[RANKING] Using prompt v{prompt_data['version']}: {prompt_data.get('name', 'Unknown')}")
    except Exception as e:
        # Fallback to hardcoded prompt if versioned prompt fails
        logger.warning(f"Failed to load versioned prompt, using default: {e}")
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

    print(GREEN + prompt + RESET)

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