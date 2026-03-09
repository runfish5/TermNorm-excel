"""
Backend fuzzy matching using rapidfuzz.

Provides API-level fuzzy matching with tunable scorer parameter
for PromptPotter evaluation sweeps.

Scorers: ratio, partial_ratio, token_sort_ratio, token_set_ratio, WRatio
Scores normalized from rapidfuzz's 0-100 to 0.0-1.0.
"""

import logging
from typing import List, Tuple
from rapidfuzz import fuzz, process

logger = logging.getLogger(__name__)

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
    threshold: int,
    scorer: str,
    limit: int,
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

    if scorer not in SCORERS:
        logger.warning(f"Unknown scorer '{scorer}', falling back to WRatio")
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
