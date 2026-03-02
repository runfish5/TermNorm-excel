"""
Backend fuzzy matching using rapidfuzz.

Provides API-level fuzzy matching with tunable scorer parameter
for PromptPotter evaluation sweeps.

Scorers: ratio, partial_ratio, token_sort_ratio, token_set_ratio, WRatio
Scores normalized from rapidfuzz's 0-100 to 0.0-1.0.
"""

from typing import List, Dict, Any, Optional, Tuple
from rapidfuzz import fuzz, process

# Map scorer names to rapidfuzz functions
SCORERS = {
    "ratio": fuzz.ratio,
    "partial_ratio": fuzz.partial_ratio,
    "token_sort_ratio": fuzz.token_sort_ratio,
    "token_set_ratio": fuzz.token_set_ratio,
    "WRatio": fuzz.WRatio,
}


def fuzzy_match_terms(
    query: str,
    candidates: List[str],
    threshold: int = 70,
    scorer: str = "WRatio",
    limit: int = 5,
) -> List[Tuple[str, float]]:
    """
    Match query against candidate terms using rapidfuzz.

    Args:
        query: Input term to match
        candidates: List of candidate terms
        threshold: Minimum score 0-100 (rapidfuzz scale)
        scorer: Algorithm name (ratio, partial_ratio, token_sort_ratio,
                token_set_ratio, WRatio)
        limit: Max results to return

    Returns:
        List of (candidate, normalized_score) tuples, score in 0.0-1.0
    """
    if not query or not candidates:
        return []

    scorer_fn = SCORERS.get(scorer, fuzz.WRatio)

    results = process.extract(
        query,
        candidates,
        scorer=scorer_fn,
        score_cutoff=threshold,
        limit=limit,
    )

    # results: list of (match, score, index) — normalize score to 0.0-1.0
    return [(match, round(score / 100.0, 4)) for match, score, _ in results]


def fuzzy_match_mappings(
    query: str,
    forward: Dict[str, Any],
    reverse: Dict[str, str],
    threshold: int = 70,
    scorer: str = "WRatio",
) -> Optional[Dict[str, Any]]:
    """
    Match query against forward/reverse mapping keys.

    Searches forward keys first, then reverse keys, same threshold.

    Args:
        query: Input term to match
        forward: Source→target mappings
        reverse: Target→source mappings
        threshold: Minimum score 0-100
        scorer: Algorithm name

    Returns:
        MatchResult dict or None
    """
    if not query:
        return None

    # Search forward mappings
    if forward:
        fwd_matches = fuzzy_match_terms(
            query, list(forward.keys()), threshold, scorer, limit=1
        )
        if fwd_matches:
            matched_key, score = fwd_matches[0]
            value = forward[matched_key]
            target = value if isinstance(value, str) else value.get("target", matched_key)
            return {
                "target": target,
                "method": "fuzzy",
                "confidence": score,
                "source": query,
                "matched_key": matched_key,
            }

    # Search reverse mappings
    if reverse:
        rev_matches = fuzzy_match_terms(
            query, list(reverse.keys()), threshold, scorer, limit=1
        )
        if rev_matches:
            matched_key, score = rev_matches[0]
            return {
                "target": matched_key,
                "method": "fuzzy",
                "confidence": score,
                "source": query,
                "matched_key": matched_key,
            }

    return None
