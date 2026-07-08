# ./backend-api/research_and_rank/call_llm_for_ranking.py
import json
import logging
import random
from rapidfuzz import fuzz, process
from core.llm_providers import llm_call
from utils.prompt_registry import get_prompt_registry
from utils.schema_registry import get_schema_registry, format_string_from_schema
from config.pipeline_config import get_node_config

logger = logging.getLogger(__name__)

_LR_CONFIG = get_node_config("llm_ranking")

# The structure block appended to every ranking prompt is RENDERED from the registry schema,
# never hand-written beside it. schema.json is the single declaration of this shape; its field
# order and description strings are the prompt (utils/schema_registry.py module docstring).
_RANKING_SCHEMA = get_schema_registry().get_schema(
    _LR_CONFIG["schema_family"], _LR_CONFIG.get("schema_version")
)

from core.log_format import TAG_PIPE


def find_top_matches(llm_string: str, candidates: list[str], n: int) -> list[tuple[str, float]]:
    """Find top N matching candidates using rapidfuzz ratio."""
    if not llm_string or not candidates:
        return []
    results = process.extract(llm_string, candidates, scorer=fuzz.ratio, limit=n)
    return [(match, round(score / 100.0, 4)) for match, score, _ in results]


def _correct_candidate_strings(ranking_result, match_results, relevance_weight_core):
    """Correct LLM-altered candidate strings by fuzzy-matching against originals.

    The ranking response is free-form JSON (no ``output_schema`` is set on the node, so
    ``llm_call`` sends ``response_format: {"type": "json_object"}`` and its schema-validate
    branch is skipped). Nothing upstream guarantees the shape, so every read here is guarded
    and malformed entries are dropped rather than raising.
    """
    original_candidates = [result[0] for result in match_results]
    corrected_candidates = []

    # A token-budget 400 makes llm_call drop response_format and retry unconstrained, which
    # permits a bare-array reply (see web_generate_entity_profile's same compensation).
    if not isinstance(ranking_result, dict):
        logger.warning(f"{TAG_PIPE} Ranking response is {type(ranking_result).__name__}, expected object")
        ranking_result = {}

    ranked = ranking_result.get('ranked_candidates')
    if not isinstance(ranked, list):
        logger.warning(f"{TAG_PIPE} Ranking response has no 'ranked_candidates' list; got {type(ranked).__name__}")
        ranked = []

    for candidate_info in ranked:
        if not isinstance(candidate_info, dict) or not candidate_info.get('candidate'):
            logger.warning(f"{TAG_PIPE} Dropping malformed ranked candidate: {candidate_info!r}")
            continue
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

    # One declaration of the shape, rendered. An `output_schema` override replaces the registry
    # schema for BOTH the prompt block and the decoder, so the two can never disagree.
    #
    # KNOWN UNEXPLOITED LEVER — field order. Fields generate in schema order, so this schema emits
    # `core_concept_score` / `spec_score` BEFORE `evaluation_reasoning`: the reasoning can only
    # rationalise scores already committed to, never inform them. The fix is to move the evidence
    # fields above the scores in `llm_ranking_output`'s schema — nothing else; the wire shape,
    # field names, and every consumer stay identical.
    #
    # It is NOT applied, and the reason is not doubt. Reordering changes model behaviour, and
    # `llm_ranking` is a demonstration node — the live `lca-bom-termnorm` pipeline terminates at
    # `token_matching` to skip this call — so there is no A/B to run and no number to settle it.
    # A behaviour change nobody can measure does not earn a place in the tree.
    #
    # UNLOCK CONDITION: the day `llm_ranking` enters a production pipeline, reorder and measure.
    # Until then the same insight lives where it IS load-bearing — PromptPotter's
    # `L1Variant.evidence_grounding`, which runs every L1 round and which `promptpotter-self`
    # measures. See PromptPotter `docs/concepts/structured-output.md`.
    ranking_schema = lr_cfg.get("output_schema")
    structure_block = format_string_from_schema(ranking_schema or _RANKING_SCHEMA)

    enhanced_prompt = f"""{prompt}

IMPORTANT: Return a valid JSON response matching this exact structure:
{structure_block}

Ensure all strings are properly escaped and avoid complex punctuation in reasoning."""

    llm_kwargs = {
        "messages": [{"role": "user", "content": enhanced_prompt}],
        "provider": lr_cfg["provider"],
        "model": lr_cfg["model"],
        "temperature": lr_cfg["temperature"],
        "max_tokens": lr_cfg.get("max_tokens"),
        "output_format": "schema" if ranking_schema else "json",
        "structured_output_mode": lr_cfg.get("structured_output_mode"),
    }
    if ranking_schema:
        llm_kwargs["schema"] = ranking_schema
    _usage: dict = {}
    ranking_result = await llm_call(**llm_kwargs, warnings=warnings, usage_out=_usage, node_name="llm_ranking")
    if usage_out is not None and _usage:
        usage_out.update(_usage)

    logger.info(f"\n{TAG_PIPE} Step 4: Correcting candidate strings")
    corrected = _correct_candidate_strings(ranking_result, match_results, relevance_weight_core=lr_cfg["relevance_weight_core"])

    debug_output_limit = lr_cfg["debug_output_limit"]
    # An empty list is a legitimate NO_RESULT (research_pipeline reads `ranked[0] if ranked`),
    # not an error — but `'ranked_candidates' in corrected` passes on [] and `candidates[0]`
    # would raise. Gate on the list being non-empty, not on the key being present.
    candidates = corrected['ranked_candidates']
    if candidates:
        top = candidates[0].get("candidate", "?")[:60]
        top_score = candidates[0].get("relevance_score", 0)
        logger.info(f"\n{TAG_PIPE} Success! {len(candidates)} matches — top: {top}... ({top_score:.3f})")
    else:
        logger.warning(f"{TAG_PIPE} No usable ranked candidates in LLM response")

    result, debug_info = _build_result(query, candidates, match_results, debug_output_limit, lr_cfg["provider"], lr_cfg["model"])

    if _usage:
        debug_info["llm_usage"] = dict(_usage)
    return result, debug_info
