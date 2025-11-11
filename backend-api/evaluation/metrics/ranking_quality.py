"""
Ranking Quality Metrics

Standard information retrieval metrics for evaluating ranking quality:
- Mean Reciprocal Rank (MRR)
- Normalized Discounted Cumulative Gain (NDCG)
- Hit Rate (Hit@K)
- Recall@K
"""

import math
from typing import List, Dict, Any, Optional


def calculate_reciprocal_rank(ranked_candidates: List[str], expected: str) -> float:
    """
    Calculate Reciprocal Rank - the reciprocal of the rank of the first relevant result

    Args:
        ranked_candidates: List of candidate strings in ranked order
        expected: The expected/correct answer

    Returns:
        Reciprocal rank (1/rank if found, 0 if not found)
    """
    try:
        rank = ranked_candidates.index(expected) + 1
        return 1.0 / rank
    except ValueError:
        return 0.0


def calculate_mrr(results: List[Dict[str, Any]]) -> float:
    """
    Calculate Mean Reciprocal Rank across multiple queries

    Args:
        results: List of result dictionaries with 'ranked_candidates' and 'expected_match' keys

    Returns:
        Mean Reciprocal Rank (0.0 to 1.0)
    """
    if not results:
        return 0.0

    rr_values = []
    for result in results:
        ranked = result.get("ranked_candidates", [])
        expected = result.get("expected_match", "")

        if not expected:
            continue

        # Extract candidate strings if dict format
        if ranked and isinstance(ranked[0], dict):
            ranked = [c.get("candidate", "") for c in ranked]

        rr = calculate_reciprocal_rank(ranked, expected)
        rr_values.append(rr)

    if not rr_values:
        return 0.0

    return sum(rr_values) / len(rr_values)


def calculate_hit_at_k(ranked_candidates: List[str], expected: str, k: int = 5) -> float:
    """
    Calculate Hit@K - whether the correct answer appears in the top K results

    Args:
        ranked_candidates: List of candidate strings in ranked order
        expected: The expected/correct answer
        k: Number of top results to consider (default: 5)

    Returns:
        1.0 if expected is in top K, 0.0 otherwise
    """
    top_k = ranked_candidates[:k]
    return 1.0 if expected in top_k else 0.0


def calculate_average_hit_at_k(results: List[Dict[str, Any]], k: int = 5) -> float:
    """
    Calculate average Hit@K across multiple queries

    Args:
        results: List of result dictionaries with 'ranked_candidates' and 'expected_match' keys
        k: Number of top results to consider (default: 5)

    Returns:
        Average hit rate (0.0 to 1.0)
    """
    if not results:
        return 0.0

    hit_values = []
    for result in results:
        ranked = result.get("ranked_candidates", [])
        expected = result.get("expected_match", "")

        if not expected:
            continue

        # Extract candidate strings if dict format
        if ranked and isinstance(ranked[0], dict):
            ranked = [c.get("candidate", "") for c in ranked]

        hit = calculate_hit_at_k(ranked, expected, k)
        hit_values.append(hit)

    if not hit_values:
        return 0.0

    return sum(hit_values) / len(hit_values)


def calculate_dcg_at_k(relevance_scores: List[float], k: int) -> float:
    """
    Calculate Discounted Cumulative Gain at K

    DCG = sum(relevance[i] / log2(i + 2)) for i in range(k)

    Args:
        relevance_scores: List of relevance scores (1 for relevant, 0 for not relevant)
        k: Number of top results to consider

    Returns:
        DCG score
    """
    dcg = 0.0
    for i in range(min(k, len(relevance_scores))):
        dcg += relevance_scores[i] / math.log2(i + 2)
    return dcg


def calculate_ndcg_at_k(ranked_candidates: List[str], expected: str, k: int = 5) -> float:
    """
    Calculate Normalized Discounted Cumulative Gain at K

    NDCG normalizes DCG by the ideal DCG (where the correct answer is at position 0)

    Args:
        ranked_candidates: List of candidate strings in ranked order
        expected: The expected/correct answer
        k: Number of top results to consider (default: 5)

    Returns:
        NDCG score (0.0 to 1.0)
    """
    # Create relevance scores (1 for correct answer, 0 for others)
    relevance_scores = [1.0 if candidate == expected else 0.0 for candidate in ranked_candidates[:k]]

    # Calculate DCG
    dcg = calculate_dcg_at_k(relevance_scores, k)

    # Calculate Ideal DCG (correct answer at position 0)
    ideal_relevance = [1.0] + [0.0] * (k - 1)
    idcg = calculate_dcg_at_k(ideal_relevance, k)

    # Return normalized score
    if idcg == 0.0:
        return 0.0

    return dcg / idcg


def calculate_average_ndcg_at_k(results: List[Dict[str, Any]], k: int = 5) -> float:
    """
    Calculate average NDCG@K across multiple queries

    Args:
        results: List of result dictionaries with 'ranked_candidates' and 'expected_match' keys
        k: Number of top results to consider (default: 5)

    Returns:
        Average NDCG score (0.0 to 1.0)
    """
    if not results:
        return 0.0

    ndcg_values = []
    for result in results:
        ranked = result.get("ranked_candidates", [])
        expected = result.get("expected_match", "")

        if not expected:
            continue

        # Extract candidate strings if dict format
        if ranked and isinstance(ranked[0], dict):
            ranked = [c.get("candidate", "") for c in ranked]

        ndcg = calculate_ndcg_at_k(ranked, expected, k)
        ndcg_values.append(ndcg)

    if not ndcg_values:
        return 0.0

    return sum(ndcg_values) / len(ndcg_values)


def calculate_recall_at_k(ranked_candidates: List[str], expected: str, k: int = 5) -> float:
    """
    Calculate Recall@K - proportion of relevant items found in top K

    For single expected answer, this is equivalent to Hit@K

    Args:
        ranked_candidates: List of candidate strings in ranked order
        expected: The expected/correct answer
        k: Number of top results to consider (default: 5)

    Returns:
        Recall score (0.0 to 1.0)
    """
    return calculate_hit_at_k(ranked_candidates, expected, k)


def calculate_comprehensive_metrics(
    results: List[Dict[str, Any]],
    k_values: List[int] = [1, 3, 5, 10]
) -> Dict[str, float]:
    """
    Calculate comprehensive ranking metrics for a set of results

    Args:
        results: List of result dictionaries with 'ranked_candidates' and 'expected_match' keys
        k_values: List of K values for Hit@K and NDCG@K (default: [1, 3, 5, 10])

    Returns:
        Dictionary of metric names to values
    """
    metrics = {}

    # Calculate MRR
    metrics["mrr"] = calculate_mrr(results)

    # Calculate Hit@K and NDCG@K for each K value
    for k in k_values:
        metrics[f"hit@{k}"] = calculate_average_hit_at_k(results, k)
        metrics[f"ndcg@{k}"] = calculate_average_ndcg_at_k(results, k)

    # Calculate average rank of correct answer
    ranks = []
    for result in results:
        ranked = result.get("ranked_candidates", [])
        expected = result.get("expected_match", "")

        if not expected:
            continue

        # Extract candidate strings if dict format
        if ranked and isinstance(ranked[0], dict):
            ranked = [c.get("candidate", "") for c in ranked]

        try:
            rank = ranked.index(expected) + 1
            ranks.append(rank)
        except ValueError:
            ranks.append(len(ranked) + 1)  # Not found, assign rank beyond list

    if ranks:
        metrics["average_rank"] = sum(ranks) / len(ranks)
        metrics["median_rank"] = sorted(ranks)[len(ranks) // 2]

    return metrics


def format_metrics_report(metrics: Dict[str, float]) -> str:
    """
    Format metrics dictionary as a readable report string

    Args:
        metrics: Dictionary of metric names to values

    Returns:
        Formatted string report
    """
    lines = ["Ranking Quality Metrics", "=" * 40]

    # Group metrics by type
    if "mrr" in metrics:
        lines.append(f"\nMean Reciprocal Rank: {metrics['mrr']:.3f}")

    # Hit@K metrics
    hit_metrics = {k: v for k, v in metrics.items() if k.startswith("hit@")}
    if hit_metrics:
        lines.append("\nHit Rate:")
        for k, v in sorted(hit_metrics.items()):
            lines.append(f"  {k}: {v:.3f}")

    # NDCG@K metrics
    ndcg_metrics = {k: v for k, v in metrics.items() if k.startswith("ndcg@")}
    if ndcg_metrics:
        lines.append("\nNDCG:")
        for k, v in sorted(ndcg_metrics.items()):
            lines.append(f"  {k}: {v:.3f}")

    # Rank metrics
    if "average_rank" in metrics:
        lines.append(f"\nAverage Rank: {metrics['average_rank']:.2f}")
    if "median_rank" in metrics:
        lines.append(f"Median Rank: {metrics['median_rank']:.0f}")

    lines.append("=" * 40)

    return "\n".join(lines)
