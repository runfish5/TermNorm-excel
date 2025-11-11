"""
MLflow Evaluation Demo for TermNorm

Complete workflow demonstrating:
1. Baseline evaluation with standard scorers
2. Prompt optimization (optional)
3. Results comparison in MLflow

This script shows how to integrate TermNorm pipeline with MLflow's
genai.evaluate() and genai.optimize_prompts() APIs.
"""

import asyncio
import mlflow
import pandas as pd
import json
import argparse
from pathlib import Path
import sys

# Add backend-api to path
backend_path = Path(__file__).parent.parent.parent
sys.path.insert(0, str(backend_path))

from evaluation.adapters.mlflow_adapter import TermNormMLflowAdapter
from evaluation.scorers import mrr_scorer, hit_at_5_scorer, ndcg_at_5_scorer
from evaluation.optimizers import SimplePromptOptimizer
from dotenv import load_dotenv

# Load environment variables
load_dotenv(backend_path / ".env")


def load_test_data(test_file: Path = None) -> pd.DataFrame:
    """
    Load test cases as pandas DataFrame for MLflow

    Args:
        test_file: Path to test cases JSON file

    Returns:
        DataFrame with columns: query, terms, expected_match, category
    """
    if test_file is None:
        test_file = backend_path / "evaluation" / "configs" / "test_datasets.json"

    with open(test_file) as f:
        data = json.load(f)

    # Convert to DataFrame
    df = pd.DataFrame(data)
    return df


async def predict_fn(row: pd.Series) -> dict:
    """
    Prediction function compatible with MLflow evaluate()

    Takes a row from the test dataset and returns predictions.

    Args:
        row: Single row from test DataFrame with 'query' and 'terms' columns

    Returns:
        Dictionary with prediction results
    """
    from api.research_pipeline import research_and_match

    # Create mock request
    class MockRequest:
        class State:
            user_id = 'mlflow_evaluation'
        state = State()

    # Prepare payload
    payload = {
        "query": row["query"],
        "terms": row["terms"]
    }

    try:
        # Run pipeline
        result = await research_and_match(
            request=MockRequest(),
            payload=payload
        )

        if result.get("status") == "success":
            data = result.get("data", {})
            return {
                "query": row["query"],
                "ranked_candidates": data.get("ranked_candidates", []),
                "status": "success"
            }
        else:
            return {
                "query": row["query"],
                "ranked_candidates": [],
                "status": "error"
            }

    except Exception as e:
        print(f"Error in predict_fn: {e}")
        return {
            "query": row["query"],
            "ranked_candidates": [],
            "status": "error"
        }


def run_predict_batch(test_data: pd.DataFrame) -> pd.DataFrame:
    """
    Run predictions on entire test dataset (synchronous version)

    Args:
        test_data: DataFrame with test cases

    Returns:
        DataFrame with predictions
    """
    results = []

    # Create event loop
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        for idx, row in test_data.iterrows():
            print(f"Running prediction {idx+1}/{len(test_data)}: {row['query']}")
            result = loop.run_until_complete(predict_fn(row))
            results.append(result)
    finally:
        loop.close()

    return pd.DataFrame(results)


async def run_predict_batch_async(test_data: pd.DataFrame) -> pd.DataFrame:
    """
    Run predictions on entire test dataset (async version)

    Args:
        test_data: DataFrame with test cases

    Returns:
        DataFrame with predictions
    """
    results = []

    for idx, row in test_data.iterrows():
        print(f"Running prediction {idx+1}/{len(test_data)}: {row['query']}")
        result = await predict_fn(row)
        results.append(result)

    return pd.DataFrame(results)


async def run_baseline_evaluation(test_data: pd.DataFrame, variant_name: str = "baseline"):
    """
    Run baseline evaluation with MLflow tracking

    Args:
        test_data: Test dataset DataFrame
        variant_name: Name for this evaluation run

    Returns:
        Evaluation results
    """
    print(f"\n{'='*60}")
    print(f"Running Baseline Evaluation: {variant_name}")
    print(f"{'='*60}\n")

    # Prepare expectations DataFrame
    expectations = test_data[["expected_match"]].copy()

    # Run predictions
    print("Running predictions...")
    predictions = await run_predict_batch_async(test_data)

    # Calculate scores
    print("\nCalculating scores...")

    with mlflow.start_run(run_name=f"eval_{variant_name}"):
        mlflow.log_param("variant", variant_name)
        mlflow.log_param("num_test_cases", len(test_data))

        # Calculate metrics
        mrr_scores = mrr_scorer(predictions, expectations)
        hit5_scores = hit_at_5_scorer(predictions, expectations)
        ndcg5_scores = ndcg_at_5_scorer(predictions, expectations)

        # Log aggregate metrics
        avg_mrr = mrr_scores.mean()
        avg_hit5 = hit5_scores.mean()
        avg_ndcg5 = ndcg5_scores.mean()

        mlflow.log_metric("mrr", avg_mrr)
        mlflow.log_metric("hit_at_5", avg_hit5)
        mlflow.log_metric("ndcg_at_5", avg_ndcg5)

        # Log detailed results
        results_df = pd.DataFrame({
            "query": test_data["query"],
            "expected": test_data["expected_match"],
            "predicted": predictions["ranked_candidates"].apply(
                lambda x: x[0].get("candidate", "") if x else ""
            ),
            "mrr": mrr_scores,
            "hit_at_5": hit5_scores,
            "ndcg_at_5": ndcg5_scores
        })

        # Save as artifact
        results_path = backend_path / "evaluation" / "results" / f"{variant_name}_results.csv"
        results_path.parent.mkdir(parents=True, exist_ok=True)
        results_df.to_csv(results_path, index=False)
        mlflow.log_artifact(str(results_path))

        print(f"\n{'='*60}")
        print("Results:")
        print(f"{'='*60}")
        print(f"MRR:     {avg_mrr:.3f}")
        print(f"Hit@5:   {avg_hit5:.3f}")
        print(f"NDCG@5:  {avg_ndcg5:.3f}")
        print(f"{'='*60}\n")

        return {
            "variant": variant_name,
            "mrr": avg_mrr,
            "hit_at_5": avg_hit5,
            "ndcg_at_5": avg_ndcg5,
            "results_df": results_df
        }


async def run_optimization(test_data: pd.DataFrame, num_variants: int = 3):
    """
    Run prompt optimization

    Args:
        test_data: Test dataset DataFrame
        num_variants: Number of variants to generate

    Returns:
        Optimization results
    """
    print(f"\n{'='*60}")
    print("Running Prompt Optimization")
    print(f"Generating {num_variants} variants")
    print(f"{'='*60}\n")

    optimizer = SimplePromptOptimizer(num_variants=num_variants)

    # Define scorers (using simple versions for optimization)
    scorers = [mrr_scorer, hit_at_5_scorer, ndcg_at_5_scorer]

    # Run optimization
    # Note: The simple optimizer doesn't actually modify prompts yet
    # This is a placeholder for the framework
    results = optimizer.optimize(
        predict_fn=lambda row: asyncio.run(predict_fn(row)),
        train_data=test_data,
        scorers=scorers
    )

    print("\nOptimization complete!")
    print("Note: This demo uses a simple optimizer that generates variant configs")
    print("To actually test different prompts, modify research_and_rank/call_llm_for_ranking.py")

    return results


async def main():
    """Main evaluation workflow"""
    parser = argparse.ArgumentParser(description="MLflow Evaluation Demo for TermNorm")
    parser.add_argument("--test-file", type=str, help="Path to test cases JSON file")
    parser.add_argument("--mode", type=str, default="baseline",
                       choices=["baseline", "optimize", "compare"],
                       help="Evaluation mode")
    parser.add_argument("--variants", type=int, default=3,
                       help="Number of variants for optimization")

    args = parser.parse_args()

    # Initialize MLflow
    tracker = TermNormMLflowAdapter()

    print("=" * 60)
    print("MLflow Evaluation Demo for TermNorm")
    print("=" * 60)

    # Load test data
    test_file = Path(args.test_file) if args.test_file else None
    test_data = load_test_data(test_file)
    print(f"\nLoaded {len(test_data)} test cases")

    if args.mode == "baseline":
        # Run baseline evaluation
        await run_baseline_evaluation(test_data, variant_name="baseline_v1")

    elif args.mode == "optimize":
        # Run baseline first
        baseline_result = await run_baseline_evaluation(test_data, variant_name="baseline_v1")

        # Run optimization
        optimization_results = await run_optimization(test_data, num_variants=args.variants)

        print("\n" + "=" * 60)
        print("Optimization Summary")
        print("=" * 60)
        print(f"Baseline MRR: {baseline_result['mrr']:.3f}")
        print("\nVariants:")
        for i, variant in enumerate(optimization_results):
            print(f"  {i+1}. {variant['variant_name']}: {variant['avg_score']:.3f}")
        print("=" * 60)

    elif args.mode == "compare":
        # Run multiple variants for comparison
        variants = ["baseline_v1", "core_focus_v1", "balanced_v1"]

        results = []
        for variant in variants:
            result = await run_baseline_evaluation(test_data, variant_name=variant)
            results.append(result)

        # Print comparison
        print("\n" + "=" * 60)
        print("Comparison Results")
        print("=" * 60)
        for result in results:
            print(f"\n{result['variant']}:")
            print(f"  MRR:     {result['mrr']:.3f}")
            print(f"  Hit@5:   {result['hit_at_5']:.3f}")
            print(f"  NDCG@5:  {result['ndcg_at_5']:.3f}")
        print("=" * 60)

    print("\n" + "=" * 60)
    print("Evaluation Complete!")
    print("\nView results in MLflow UI:")
    print("  mlflow ui --port 5000")
    print("  Open: http://localhost:5000")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
