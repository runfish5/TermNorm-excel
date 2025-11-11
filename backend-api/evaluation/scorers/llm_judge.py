"""
LLM-as-Judge Scorer for Semantic Evaluation

Uses an LLM to evaluate whether the top-ranked candidate is semantically correct.
Provides more nuanced evaluation than exact string matching.
"""

import asyncio
import pandas as pd
from typing import Any, Dict
import sys
from pathlib import Path

# Add backend-api to path for imports
backend_path = Path(__file__).parent.parent.parent
sys.path.insert(0, str(backend_path))

from core.llm_providers import llm_call


async def _judge_single_result(query: str, top_candidate: str, expected: str) -> float:
    """
    Use LLM to judge if top candidate is semantically correct

    Args:
        query: Original query term
        top_candidate: Top-ranked candidate from pipeline
        expected: Expected correct answer

    Returns:
        Score from 0.0 to 1.0 (1.0 = semantically correct)
    """
    prompt = f"""You are evaluating a term normalization system.

TASK: Determine if the predicted match is semantically equivalent to the expected answer.

Query: "{query}"
Predicted Match: "{top_candidate}"
Expected Answer: "{expected}"

Evaluation Criteria:
- Exact match = 1.0
- Semantically equivalent (same meaning, different wording) = 0.9
- Very close (minor differences) = 0.7
- Partially correct (related but missing key elements) = 0.5
- Somewhat related = 0.3
- Wrong category or unrelated = 0.0

Return ONLY a JSON object with this format:
{{
  "score": 0.0-1.0,
  "reasoning": "brief explanation"
}}"""

    try:
        result = await llm_call(
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=200,
            output_format="json"
        )

        if isinstance(result, dict) and "score" in result:
            score = float(result["score"])
            # Clamp score to [0, 1]
            return max(0.0, min(1.0, score))
        else:
            # Fallback: binary exact match
            return 1.0 if top_candidate.lower() == expected.lower() else 0.0

    except Exception as e:
        print(f"LLM judge error: {e}")
        # Fallback to exact match
        return 1.0 if top_candidate.lower() == expected.lower() else 0.0


def llm_judge_scorer(outputs: pd.DataFrame, expectations: pd.DataFrame) -> pd.Series:
    """
    LLM-as-judge scorer for MLflow

    Uses an LLM to evaluate semantic correctness of top-ranked candidates.
    More nuanced than exact string matching.

    Args:
        outputs: DataFrame with 'query' and 'ranked_candidates' columns
        expectations: DataFrame with 'expected_match' column

    Returns:
        Series of semantic correctness scores (0.0 to 1.0)
    """
    scores = []

    # Create event loop for async LLM calls
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        for idx in outputs.index:
            try:
                # Extract data
                query = outputs.loc[idx, "query"] if "query" in outputs.columns else ""
                ranked_candidates = outputs.loc[idx, "ranked_candidates"]
                expected = expectations.loc[idx, "expected_match"]

                if not expected or not ranked_candidates:
                    scores.append(0.0)
                    continue

                # Get top candidate
                if isinstance(ranked_candidates[0], dict):
                    top_candidate = ranked_candidates[0].get("candidate", "")
                else:
                    top_candidate = ranked_candidates[0]

                if not top_candidate:
                    scores.append(0.0)
                    continue

                # Get LLM judgment
                score = loop.run_until_complete(
                    _judge_single_result(query, top_candidate, expected)
                )
                scores.append(score)

                print(f"  LLM Judge: {top_candidate} vs {expected} = {score:.2f}")

            except Exception as e:
                print(f"Error judging row {idx}: {e}")
                scores.append(0.0)

    finally:
        loop.close()

    return pd.Series(scores, index=outputs.index)


# Simplified version that doesn't require async
def llm_judge_scorer_sync(outputs: pd.DataFrame, expectations: pd.DataFrame) -> pd.Series:
    """
    Synchronous version of LLM judge (for compatibility)

    Falls back to fuzzy string matching instead of LLM calls.

    Args:
        outputs: DataFrame with 'ranked_candidates' columns
        expectations: DataFrame with 'expected_match' column

    Returns:
        Series of approximate semantic scores
    """
    from difflib import SequenceMatcher

    scores = []

    for idx in outputs.index:
        try:
            ranked_candidates = outputs.loc[idx, "ranked_candidates"]
            expected = expectations.loc[idx, "expected_match"]

            if not expected or not ranked_candidates:
                scores.append(0.0)
                continue

            # Get top candidate
            if isinstance(ranked_candidates[0], dict):
                top_candidate = ranked_candidates[0].get("candidate", "")
            else:
                top_candidate = ranked_candidates[0]

            if not top_candidate:
                scores.append(0.0)
                continue

            # Calculate similarity
            similarity = SequenceMatcher(None, top_candidate.lower(), expected.lower()).ratio()
            scores.append(similarity)

        except Exception as e:
            print(f"Error in fuzzy matching for row {idx}: {e}")
            scores.append(0.0)

    return pd.Series(scores, index=outputs.index)
