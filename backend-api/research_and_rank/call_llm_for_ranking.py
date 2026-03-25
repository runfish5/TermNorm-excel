# ./backend-api/research_and_rank/call_llm_for_ranking.py
import json
from typing import Optional
from core.llm_providers import llm_call, LLM_PROVIDER, LLM_MODEL
from .correct_candidate_strings import correct_candidate_strings
import random
from utils.prompt_registry import get_prompt_registry
from config.pipeline_config import get_node_config

_LR_CONFIG = get_node_config("llm_ranking")

from utils.utils import GREEN, YELLOW, BRIGHT_RED, RESET


def _build_result(query: str, candidates: list, match_results: list[tuple[str, float]], debug_output_limit: int) -> tuple[dict, dict]:
    """Build standardized (result, debug_info) tuple for ranking responses."""
    result = {
        "query": query,
        "total_matches": len(candidates),
        "research_performed": True,
        "ranked_candidates": candidates,
        "llm_provider": f"{LLM_PROVIDER}/{LLM_MODEL}",
    }
    debug_info = {"inputs": {"token_matched_candidates": match_results[:debug_output_limit]}}
    return result, debug_info


async def call_llm_for_ranking(
    profile_info: str,
    entity_profile: dict,
    match_results: list[tuple[str, float]],
    query: str,
    temperature: float,
    max_tokens: int,
    sample_size: int,
    relevance_weight_core: float,
    ranking_prompt: Optional[str] = None,
    ranking_schema: Optional[dict] = None,
    ranking_model: Optional[str] = None,
    debug_output_limit: int = 20,
    warnings: list[str] | None = None,
) -> tuple[dict, dict]:
    """Rank candidates using LLM and return (result, debug_info) tuple."""
    available_results = list(match_results[:sample_size])
    effective_sample = min(len(available_results), sample_size)
    random_20 = random.sample(available_results, effective_sample) if available_results else []
    matches = "\n".join(f"- {term}" for term, score in random_20)
    core_concept = entity_profile["core_concept"]

    entity_profile_json = json.dumps(entity_profile, indent=2)

    if ranking_prompt:
        # Use custom prompt with {{variable}} substitution
        prompt = ranking_prompt.replace("{{core_concept}}", core_concept)
        prompt = prompt.replace("{{entity_profile_json}}", entity_profile_json)
        prompt = prompt.replace("{{matches}}", matches)
    else:
        # Get prompt from registry
        registry = get_prompt_registry()
        prompt = registry.render_prompt(
            family=_LR_CONFIG["prompt_family"],
            version=_LR_CONFIG["prompt_version"],
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

    llm_kwargs = {
        "messages": [{"role": "user", "content": enhanced_prompt}],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "output_format": "schema" if ranking_schema else "json",
    }
    if ranking_schema:
        llm_kwargs["schema"] = ranking_schema
    if ranking_model:
        llm_kwargs["model"] = ranking_model
    ranking_result = await llm_call(**llm_kwargs, warnings=warnings)

    print(f"\n{YELLOW}[PIPELINE] Step 4: Correcting candidate strings{RESET}")
    corrected = correct_candidate_strings(ranking_result, match_results, relevance_weight_core=relevance_weight_core)

    if corrected and 'ranked_candidates' in corrected:
        candidates = corrected['ranked_candidates']
        top = candidates[0].get("candidate", "?")[:60]
        top_score = candidates[0].get("relevance_score", 0)
        print(f"\n{GREEN}[PIPELINE] Success! {len(candidates)} matches — top: {top}... ({top_score:.3f}){RESET}")

        return _build_result(query, candidates, match_results, debug_output_limit)

    print(f"{BRIGHT_RED}[WARNING] Unexpected results format: {type(corrected)}{RESET}")
    return _build_result(query, [], match_results, debug_output_limit)
