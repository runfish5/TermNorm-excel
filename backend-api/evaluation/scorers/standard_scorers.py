"""
Standard Information Retrieval Scorers for MLflow

Wraps existing ranking quality metrics as MLflow scorers.
Compatible with mlflow.genai.evaluate() API.
"""

from typing import Any, Dict
import pandas as pd


def mrr_scorer(outputs: pd.DataFrame, expectations: pd.DataFrame) -> pd.Series:
    """
    Mean Reciprocal Rank (MRR) scorer for MLflow

    Calculates the reciprocal rank of the first correct answer.
    Higher is better (range: 0.0 to 1.0)

    Args:
        outputs: DataFrame with 'ranked_candidates' column (list of dicts)
        expectations: DataFrame with 'expected_match' column (expected answer string)

    Returns:
        Series of MRR scores for each row
    """
    scores = []

    for idx in outputs.index:
        try:
            ranked_candidates = outputs.loc[idx, "ranked_candidates"]
            expected = expectations.loc[idx, "expected_match"]

            if not expected or not ranked_candidates:
                scores.append(0.0)
                continue

            # Extract candidate strings if dict format
            if isinstance(ranked_candidates[0], dict):
                candidate_strings = [c.get("candidate", "") for c in ranked_candidates]
            else:
                candidate_strings = ranked_candidates

            # Find rank of expected answer
            try:
                rank = candidate_strings.index(expected) + 1
                scores.append(1.0 / rank)
            except ValueError:
                scores.append(0.0)

        except Exception as e:
            print(f"Error calculating MRR for row {idx}: {e}")
            scores.append(0.0)

    return pd.Series(scores, index=outputs.index)


def hit_at_k_scorer(k: int = 5):
    """
    Factory function to create Hit@K scorer

    Args:
        k: Number of top results to consider

    Returns:
        Scorer function compatible with MLflow
    """
    def scorer(outputs: pd.DataFrame, expectations: pd.DataFrame) -> pd.Series:
        """
        Hit@K scorer - whether correct answer appears in top K results

        Args:
            outputs: DataFrame with 'ranked_candidates' column
            expectations: DataFrame with 'expected_match' column

        Returns:
            Series of binary scores (1.0 if hit, 0.0 otherwise)
        """
        scores = []

        for idx in outputs.index:
            try:
                ranked_candidates = outputs.loc[idx, "ranked_candidates"]
                expected = expectations.loc[idx, "expected_match"]

                if not expected or not ranked_candidates:
                    scores.append(0.0)
                    continue

                # Extract candidate strings if dict format
                if isinstance(ranked_candidates[0], dict):
                    candidate_strings = [c.get("candidate", "") for c in ranked_candidates]
                else:
                    candidate_strings = ranked_candidates

                # Check if expected is in top K
                top_k = candidate_strings[:k]
                scores.append(1.0 if expected in top_k else 0.0)

            except Exception as e:
                print(f"Error calculating Hit@{k} for row {idx}: {e}")
                scores.append(0.0)

        return pd.Series(scores, index=outputs.index)

    scorer.__name__ = f"hit_at_{k}"
    return scorer


def ndcg_at_k_scorer(k: int = 5):
    """
    Factory function to create NDCG@K scorer

    Args:
        k: Number of top results to consider

    Returns:
        Scorer function compatible with MLflow
    """
    def scorer(outputs: pd.DataFrame, expectations: pd.DataFrame) -> pd.Series:
        """
        NDCG@K scorer - Normalized Discounted Cumulative Gain

        Measures ranking quality with position-based discount.
        Higher positions have more weight.

        Args:
            outputs: DataFrame with 'ranked_candidates' column
            expectations: DataFrame with 'expected_match' column

        Returns:
            Series of NDCG scores (0.0 to 1.0)
        """
        import math

        scores = []

        for idx in outputs.index:
            try:
                ranked_candidates = outputs.loc[idx, "ranked_candidates"]
                expected = expectations.loc[idx, "expected_match"]

                if not expected or not ranked_candidates:
                    scores.append(0.0)
                    continue

                # Extract candidate strings if dict format
                if isinstance(ranked_candidates[0], dict):
                    candidate_strings = [c.get("candidate", "") for c in ranked_candidates]
                else:
                    candidate_strings = ranked_candidates

                # Create relevance scores (1 for correct, 0 for others)
                top_k = candidate_strings[:k]
                relevance_scores = [1.0 if candidate == expected else 0.0 for candidate in top_k]

                # Calculate DCG
                dcg = 0.0
                for i, relevance in enumerate(relevance_scores):
                    dcg += relevance / math.log2(i + 2)

                # Calculate Ideal DCG (correct answer at position 0)
                idcg = 1.0 / math.log2(2)  # log2(0 + 2) = log2(2) = 1

                # Calculate NDCG
                ndcg = dcg / idcg if idcg > 0 else 0.0
                scores.append(ndcg)

            except Exception as e:
                print(f"Error calculating NDCG@{k} for row {idx}: {e}")
                scores.append(0.0)

        return pd.Series(scores, index=outputs.index)

    scorer.__name__ = f"ndcg_at_{k}"
    return scorer


# Create default scorer instances
hit_at_5_scorer = hit_at_k_scorer(5)
ndcg_at_5_scorer = ndcg_at_k_scorer(5)
