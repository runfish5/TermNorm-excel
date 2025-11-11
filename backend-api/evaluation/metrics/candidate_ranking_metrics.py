"""
Evaluation metrics for candidate ranking stage
Measures: MRR, Precision@K, score accuracy, rank correlation
"""
from typing import List, Dict, Any, Tuple
import math


class CandidateRankingMetrics:
    """Metrics for evaluating candidate ranking quality"""

    @staticmethod
    def mean_reciprocal_rank(ranked_candidates: List[str], expected_top_k: List[str]) -> float:
        """
        Calculate MRR - measures how high the first relevant result appears

        Args:
            ranked_candidates: Ordered list of candidates from model
            expected_top_k: List of acceptable correct answers

        Returns: Float 0.0-1.0 (1.0 = first result is correct)
        """
        if not ranked_candidates or not expected_top_k:
            return 0.0

        for rank, candidate in enumerate(ranked_candidates, start=1):
            if candidate in expected_top_k:
                return 1.0 / rank

        return 0.0

    @staticmethod
    def precision_at_k(ranked_candidates: List[str], expected_top_k: List[str], k: int = 3) -> float:
        """
        Calculate Precision@K - what fraction of top K results are relevant

        Args:
            ranked_candidates: Ordered list of candidates from model
            expected_top_k: List of acceptable correct answers
            k: Number of top results to consider

        Returns: Float 0.0-1.0
        """
        if not ranked_candidates or not expected_top_k:
            return 0.0

        top_k = ranked_candidates[:k]
        relevant_count = sum(1 for candidate in top_k if candidate in expected_top_k)

        return relevant_count / k

    @staticmethod
    def recall_at_k(ranked_candidates: List[str], expected_top_k: List[str], k: int = 5) -> float:
        """
        Calculate Recall@K - what fraction of relevant results appear in top K

        Args:
            ranked_candidates: Ordered list of candidates from model
            expected_top_k: List of acceptable correct answers
            k: Number of top results to consider

        Returns: Float 0.0-1.0
        """
        if not ranked_candidates or not expected_top_k:
            return 0.0

        top_k = ranked_candidates[:k]
        found_count = sum(1 for expected in expected_top_k if expected in top_k)

        return found_count / len(expected_top_k)

    @staticmethod
    def ndcg_at_k(ranked_candidates: List[str], expected_top_k: List[str], k: int = 5) -> float:
        """
        Calculate NDCG@K - Normalized Discounted Cumulative Gain
        Measures ranking quality with position-based discounting

        Args:
            ranked_candidates: Ordered list of candidates from model
            expected_top_k: List of acceptable correct answers (ordered by preference)
            k: Number of top results to consider

        Returns: Float 0.0-1.0
        """
        if not ranked_candidates or not expected_top_k:
            return 0.0

        def dcg(relevances: List[int], k: int) -> float:
            """Calculate DCG for given relevances"""
            dcg_sum = 0.0
            for i, rel in enumerate(relevances[:k], start=1):
                dcg_sum += rel / math.log2(i + 1)
            return dcg_sum

        # Calculate relevance scores (position in expected_top_k determines relevance)
        relevances = []
        for candidate in ranked_candidates[:k]:
            if candidate in expected_top_k:
                # Higher relevance for earlier positions in expected list
                pos = expected_top_k.index(candidate)
                relevance = len(expected_top_k) - pos
            else:
                relevance = 0
            relevances.append(relevance)

        # Calculate ideal DCG (perfect ordering)
        ideal_relevances = sorted(range(len(expected_top_k), 0, -1), reverse=True)
        idcg = dcg(ideal_relevances, k)

        if idcg == 0:
            return 0.0

        # Calculate actual DCG
        actual_dcg = dcg(relevances, k)

        return actual_dcg / idcg

    @staticmethod
    def core_concept_score_accuracy(
        ranked_results: List[Dict[str, Any]],
        expected_scores: Dict[str, Tuple[float, float]]
    ) -> Dict[str, Any]:
        """
        Check if core concept scores fall within expected ranges

        Args:
            ranked_results: List of dicts with 'candidate' and 'core_concept_score'
            expected_scores: Dict mapping candidate -> (min_score, max_score)

        Returns: Dict with accuracy metrics and violations
        """
        violations = []
        in_range_count = 0
        total_checked = 0

        for result in ranked_results:
            candidate = result.get('candidate', '')
            actual_score = result.get('core_concept_score', 0.0)

            if candidate in expected_scores:
                min_score, max_score = expected_scores[candidate]
                total_checked += 1

                if min_score <= actual_score <= max_score:
                    in_range_count += 1
                else:
                    violations.append({
                        'candidate': candidate,
                        'actual_score': actual_score,
                        'expected_range': [min_score, max_score],
                        'deviation': min(abs(actual_score - min_score), abs(actual_score - max_score))
                    })

        accuracy = in_range_count / total_checked if total_checked > 0 else 0.0

        return {
            'accuracy': accuracy,
            'in_range_count': in_range_count,
            'total_checked': total_checked,
            'violations': violations
        }

    @staticmethod
    def rank_correlation(ranked_candidates: List[str], expected_order: List[str]) -> float:
        """
        Calculate Spearman rank correlation between actual and expected ordering

        Args:
            ranked_candidates: Ordered list of candidates from model
            expected_order: Expected ordering of candidates

        Returns: Float -1.0 to 1.0 (1.0 = perfect agreement)
        """
        # Only consider candidates that appear in both lists
        common = set(ranked_candidates) & set(expected_order)
        if len(common) < 2:
            return 0.0

        # Get ranks for common candidates
        actual_ranks = {c: i for i, c in enumerate(ranked_candidates) if c in common}
        expected_ranks = {c: i for i, c in enumerate(expected_order) if c in common}

        # Calculate Spearman's rho
        n = len(common)
        sum_d_squared = sum((actual_ranks[c] - expected_ranks[c]) ** 2 for c in common)

        rho = 1 - (6 * sum_d_squared) / (n * (n**2 - 1))
        return rho

    @classmethod
    def evaluate_all(
        cls,
        ranked_results: List[Dict[str, Any]],
        expected_top_k: List[str],
        expected_scores: Dict[str, Tuple[float, float]] = None
    ) -> Dict[str, Any]:
        """
        Run all candidate ranking metrics

        Args:
            ranked_results: List of dicts with 'candidate', 'core_concept_score', etc.
            expected_top_k: Expected top candidates (ordered by preference)
            expected_scores: Optional dict of expected score ranges

        Returns: Comprehensive evaluation report
        """
        ranked_candidates = [r.get('candidate', '') for r in ranked_results]

        metrics = {
            'mrr': cls.mean_reciprocal_rank(ranked_candidates, expected_top_k),
            'precision_at_1': cls.precision_at_k(ranked_candidates, expected_top_k, k=1),
            'precision_at_3': cls.precision_at_k(ranked_candidates, expected_top_k, k=3),
            'precision_at_5': cls.precision_at_k(ranked_candidates, expected_top_k, k=5),
            'recall_at_5': cls.recall_at_k(ranked_candidates, expected_top_k, k=5),
            'ndcg_at_5': cls.ndcg_at_k(ranked_candidates, expected_top_k, k=5),
            'rank_correlation': cls.rank_correlation(ranked_candidates, expected_top_k)
        }

        if expected_scores:
            metrics['score_accuracy'] = cls.core_concept_score_accuracy(ranked_results, expected_scores)

        return metrics
