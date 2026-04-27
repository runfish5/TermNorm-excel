# ./backend-api/research_and_rank/call_llm_for_ranking.py
import json
import logging
import random
from rapidfuzz import fuzz, process
from core.llm_providers import llm_call
from utils.prompt_registry import get_prompt_registry
from config.pipeline_config import get_node_config

logger = logging.getLogger(__name__)

_LR_CONFIG = get_node_config("llm_ranking")

from utils.utils import GREEN, YELLOW, BRIGHT_RED, RESET


def find_top_matches(llm_string: str, candidates: list[str], n: int) -> list[tuple[str, float]]:
    """Find top N matching candidates using rapidfuzz ratio."""
    if not llm_string or not candidates:
        return []
    results = process.extract(llm_string, candidates, scorer=fuzz.ratio, limit=n)
    return [(match, round(score / 100.0, 4)) for match, score, _ in results]


def _correct_candidate_strings(ranking_result, match_results, relevance_weight_core):
    """Correct LLM-altered candidate strings by fuzzy-matching against originals."""
    original_candidates = [result[0] for result in match_results]
    corrected_candidates = []

    for candidate_info in ranking_result['ranked_candidates']:
        llm_candidate = candidate_info['candidate']
        top = find_top_matches(llm_candidate, original_candidates, n=1)
        best_match, similarity = top[0] if top else (None, 0)

        corrected_info = candidate_info.copy()
        if best_match != llm_candidate:
            corrected_info['_original_llm_string'] = llm_candidate
            corrected_info['candidate'] = best_match
            corrected_info['_correction_confidence'] = similarity
        else:
            corrected_info['_correction_confidence'] = 1.0

        core_score = corrected_info.get('core_concept_score', 0.0)
        spec_score = corrected_info.get('spec_score', 0.0)
        corrected_info['relevance_score'] = round(
            core_score * relevance_weight_core + spec_score * (1 - relevance_weight_core), 4)
        corrected_candidates.append(corrected_info)

    ranking_result['ranked_candidates'] = corrected_candidates
    return ranking_result


def _build_result(query: str, candidates: list, match_results: list[tuple[str, float]], debug_output_limit: int, provider: str, model: str) -> tuple[dict, dict]:
    """Build standardized (result, debug_info) tuple for ranking responses."""
    result = {
        "query": query,
        "total_matches": len(candidates),
        "research_performed": True,
        "ranked_candidates": candidates,
        "llm_provider": f"{provider}/{model}",
    }
    debug_info = {"inputs": {"candidate_ranking": match_results[:debug_output_limit]}}
    return result, debug_info


async def call_llm_for_ranking(
    entity_profile: dict,
    match_results: list[tuple[str, float]],
    query: str,
    lr_cfg: dict,
    warnings: list[str] | None = None,
    usage_out: dict | None = None,
) -> tuple[dict, dict]:
    """Rank candidates using LLM and return (result, debug_info) tuple.

    Args:
        lr_cfg: LLM ranking node config dict (temperature, max_tokens, sample_size,
                relevance_weight_core, prompt, output_schema, model, debug_output_limit).
        usage_out: Optional dict to receive the provider's token usage
            (``{"input": int, "output": int}``). Also mirrored into
            ``debug_info["llm_usage"]``.
    """
    sample_size = lr_cfg["sample_size"]
    available_results = list(match_results[:sample_size])
    effective_sample = min(len(available_results), sample_size)
    random_20 = random.sample(available_results, effective_sample) if available_results else []
    matches = "\n".join(f"- {term}" for term, score in random_20)
    core_concept = entity_profile["core_concept"]

    entity_profile_json = json.dumps(entity_profile, indent=2)

    ranking_prompt = lr_cfg.get("prompt")
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

    ranking_schema = lr_cfg.get("output_schema")
    llm_kwargs = {
        "messages": [{"role": "user", "content": enhanced_prompt}],
        "provider": lr_cfg["provider"],
        "model": lr_cfg["model"],
        "temperature": lr_cfg["temperature"],
        "max_tokens": lr_cfg.get("max_tokens"),
        "output_format": "schema" if ranking_schema else "json",
    }
    if ranking_schema:
        llm_kwargs["schema"] = ranking_schema
    _usage: dict = {}
    ranking_result = await llm_call(**llm_kwargs, warnings=warnings, usage_out=_usage)
    if usage_out is not None and _usage:
        usage_out.update(_usage)

    logger.info(f"\n{YELLOW}[PIPELINE] Step 4: Correcting candidate strings{RESET}")
    corrected = _correct_candidate_strings(ranking_result, match_results, relevance_weight_core=lr_cfg["relevance_weight_core"])

    debug_output_limit = lr_cfg["debug_output_limit"]
    if corrected and 'ranked_candidates' in corrected:
        candidates = corrected['ranked_candidates']
        top = candidates[0].get("candidate", "?")[:60]
        top_score = candidates[0].get("relevance_score", 0)
        logger.info(f"\n{GREEN}[PIPELINE] Success! {len(candidates)} matches — top: {top}... ({top_score:.3f}){RESET}")

        result, debug_info = _build_result(query, candidates, match_results, debug_output_limit, lr_cfg["provider"], lr_cfg["model"])
    else:
        logger.warning(f"{BRIGHT_RED}[WARNING] Unexpected results format: {type(corrected)}{RESET}")
        result, debug_info = _build_result(query, [], match_results, debug_output_limit, lr_cfg["provider"], lr_cfg["model"])

    if _usage:
        debug_info["llm_usage"] = dict(_usage)
    return result, debug_info
