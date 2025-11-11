"""
Experiment Runner for TermNorm Prompt Optimization

Run prompt variant experiments and compare results.
"""

import asyncio
import mlflow
import json
from pathlib import Path
import sys
import argparse
from typing import List, Dict, Any

# Add backend-api to path
backend_path = Path(__file__).parent.parent.parent
sys.path.insert(0, str(backend_path))

from evaluation.adapters.mlflow_adapter import TermNormMLflowAdapter
from dotenv import load_dotenv

# Load environment variables
load_dotenv(backend_path / ".env")


async def load_test_cases(test_file: Path = None) -> List[Dict[str, Any]]:
    """
    Load test cases from JSON file

    Args:
        test_file: Path to test cases file. If None, uses default location.

    Returns:
        List of test case dictionaries
    """
    if test_file is None:
        test_file = Path(__file__).parent.parent / "configs" / "test_datasets.json"

    if not test_file.exists():
        # Create sample test cases
        print(f"Test file not found at {test_file}")
        print("Creating sample test cases...")

        sample_cases = [
            {
                "query": "stainless steel pipe",
                "terms": ["steel pipe", "stainless tube", "metal pipe", "ss pipe", "stainless piping"],
                "expected_match": "stainless steel pipe",
                "category": "materials"
            },
            {
                "query": "carbon fiber composite",
                "terms": ["carbon composite", "fiber material", "cfrp", "composite material", "carbon fiber"],
                "expected_match": "carbon fiber",
                "category": "materials"
            },
            {
                "query": "laser welding",
                "terms": ["welding", "laser joining", "fusion welding", "laser bonding", "beam welding"],
                "expected_match": "laser welding",
                "category": "processes"
            }
        ]

        test_file.parent.mkdir(parents=True, exist_ok=True)
        with open(test_file, 'w') as f:
            json.dump(sample_cases, f, indent=2)

        print(f"Created sample test file at: {test_file}")
        return sample_cases

    with open(test_file) as f:
        return json.load(f)


async def run_single_test(payload: Dict[str, Any], verbose: bool = False) -> Dict[str, Any]:
    """
    Run a single test case through the pipeline

    Args:
        payload: Test case payload
        verbose: Print detailed output

    Returns:
        Pipeline result
    """
    # Import here to avoid circular imports
    from api.research_pipeline import research_and_match
    from fastapi import Request

    # Create mock request object
    class MockRequest:
        class State:
            user_id = 'experiment_runner'

        state = State()

    try:
        result = await research_and_match(
            request=MockRequest(),
            payload=payload
        )

        if verbose:
            print(f"  Query: {payload.get('query', '')}")
            if result.get("status") == "success":
                candidates = result.get("data", {}).get("ranked_candidates", [])
                if candidates:
                    top = candidates[0]
                    print(f"  Top Result: {top.get('candidate', '')} (core: {top.get('core_concept_score', 0):.2f})")
            print()

        return result

    except Exception as e:
        print(f"  ERROR: {type(e).__name__}: {str(e)}")
        return {
            "status": "error",
            "message": str(e),
            "data": {}
        }


async def run_prompt_variant_experiment(
    variant_name: str,
    test_cases: List[Dict[str, Any]],
    verbose: bool = False
) -> List[Dict[str, Any]]:
    """
    Run experiment for a specific prompt variant

    Args:
        variant_name: Name of the prompt variant being tested
        test_cases: List of test cases to run
        verbose: Print detailed output

    Returns:
        List of results for each test case
    """
    tracker = TermNormMLflowAdapter()

    with mlflow.start_run(run_name=f"variant_{variant_name}"):
        mlflow.log_param("prompt_variant", variant_name)
        mlflow.log_param("num_test_cases", len(test_cases))

        print(f"\n{'='*60}")
        print(f"Running Variant: {variant_name}")
        print(f"Test Cases: {len(test_cases)}")
        print(f"{'='*60}")

        results = []

        for i, test_case in enumerate(test_cases):
            print(f"\n[{i+1}/{len(test_cases)}] Testing: {test_case.get('query', '')[:50]}...")

            # Run the test case
            result = await run_single_test(test_case, verbose=verbose)
            results.append({
                "test_case": test_case,
                "result": result
            })

            # Log per-test-case metrics in nested run
            with mlflow.start_run(run_name=f"test_case_{i}", nested=True):
                mlflow.log_param("query", test_case.get("query", ""))
                mlflow.log_param("category", test_case.get("category", "uncategorized"))

                if result.get("status") == "success":
                    data = result.get("data", {})
                    candidates = data.get("ranked_candidates", [])

                    if candidates:
                        top = candidates[0]
                        mlflow.log_metric("top1_core_score", top.get("core_concept_score", 0))
                        mlflow.log_metric("top1_spec_score", top.get("spec_score", 0))
                        mlflow.log_metric("num_candidates", len(candidates))

                    # Check if expected match is in top results
                    expected = test_case.get("expected_match")
                    if expected:
                        top_candidates = [c.get("candidate", "") for c in candidates[:5]]
                        hit_at_5 = 1 if expected in top_candidates else 0
                        mlflow.log_metric("hit_at_5", hit_at_5)

                        # Calculate rank of expected match
                        try:
                            rank = top_candidates.index(expected) + 1
                            mlflow.log_metric("expected_rank", rank)
                            mlflow.log_metric("reciprocal_rank", 1.0 / rank)
                        except ValueError:
                            mlflow.log_metric("expected_rank", 0)  # Not found
                            mlflow.log_metric("reciprocal_rank", 0.0)

        # Calculate and log aggregate metrics
        successful_runs = [r for r in results if r["result"].get("status") == "success"]
        print(f"\n{'='*60}")
        print(f"Variant '{variant_name}' Complete")
        print(f"Successful: {len(successful_runs)}/{len(results)}")

        if successful_runs:
            # Calculate Mean Reciprocal Rank (MRR)
            mrr_values = []
            for r in successful_runs:
                test_case = r["test_case"]
                expected = test_case.get("expected_match")
                if expected:
                    candidates = r["result"].get("data", {}).get("ranked_candidates", [])
                    top_candidates = [c.get("candidate", "") for c in candidates]
                    try:
                        rank = top_candidates.index(expected) + 1
                        mrr_values.append(1.0 / rank)
                    except ValueError:
                        mrr_values.append(0.0)

            if mrr_values:
                mrr = sum(mrr_values) / len(mrr_values)
                mlflow.log_metric("mean_reciprocal_rank", mrr)
                print(f"MRR: {mrr:.3f}")

            # Calculate average scores
            avg_core = sum(
                r["result"].get("data", {}).get("ranked_candidates", [{}])[0].get("core_concept_score", 0)
                for r in successful_runs
            ) / len(successful_runs)
            mlflow.log_metric("avg_top1_core_score", avg_core)
            print(f"Avg Top-1 Core Score: {avg_core:.3f}")

        print(f"{'='*60}\n")

        return results


async def main():
    """Main experiment runner"""
    parser = argparse.ArgumentParser(description="Run TermNorm prompt optimization experiments")
    parser.add_argument("--test-file", type=str, help="Path to test cases JSON file")
    parser.add_argument("--variant", type=str, default="baseline_v1", help="Prompt variant name")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--compare", action="store_true", help="Run comparison between multiple variants")

    args = parser.parse_args()

    print("=" * 60)
    print("TermNorm Prompt Optimization Experiment Runner")
    print("=" * 60)

    # Load test cases
    test_file = Path(args.test_file) if args.test_file else None
    test_cases = await load_test_cases(test_file)
    print(f"\nLoaded {len(test_cases)} test cases")

    if args.compare:
        # Run multiple variants for comparison
        variants = ["baseline_v1", "enhanced_v2"]
        print(f"\nRunning comparison across variants: {', '.join(variants)}")

        for variant in variants:
            await run_prompt_variant_experiment(variant, test_cases, args.verbose)

    else:
        # Run single variant
        await run_prompt_variant_experiment(args.variant, test_cases, args.verbose)

    print("\n" + "=" * 60)
    print("Experiment Complete!")
    print("\nView results:")
    print("  mlflow ui --port 5000")
    print("  Open: http://localhost:5000")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
