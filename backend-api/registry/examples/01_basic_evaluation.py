"""
Example 1: Basic Evaluation Run

Demonstrates:
- Creating an experiment
- Creating an evaluation run
- Logging parameters, metrics, artifacts
- Finishing a run
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from registry import Registry, ExperimentType, RunType, RunStatus

def main():
    # Initialize registry
    registry = Registry()

    print("=" * 60)
    print("Example 1: Basic Evaluation Run")
    print("=" * 60)

    # Create experiment
    print("\n1. Creating experiment...")
    experiment_id = registry.create_experiment(
        name="baseline_evaluation_example",
        experiment_type=ExperimentType.EVALUATION,
        description="Example baseline prompt performance evaluation",
        created_by="example_user"
    )
    print(f"   Created experiment: {experiment_id}")

    # Create run
    print("\n2. Creating run...")
    run_id = registry.create_run(
        experiment_id=experiment_id,
        run_name="baseline_v1_example",
        run_type=RunType.EVALUATION,
        dataset_name="example_queries.test.v0",
        dataset_path="registry/data/datasets/example_queries.test.v0.jsonl",
        config={
            "model": "groq/llama-3.3-70b",
            "prompt_version": "v1",
            "temperature": 0.0
        }
    )
    print(f"   Created run: {run_id}")

    # Log parameters
    print("\n3. Logging parameters...")
    registry.log_params(run_id, {
        "model": "groq/llama-3.3-70b",
        "prompt_version": "v1",
        "temperature": 0.0,
        "step1_prompt": "extraction_v1",
        "step3_prompt": "reranker_v1"
    })
    print("   Parameters logged")

    # Log metrics
    print("\n4. Logging metrics...")
    registry.log_metrics(run_id, {
        "mrr": 0.85,
        "hit@5": 0.92,
        "ndcg@5": 0.88,
        "total_time_seconds": 45.2,
        "avg_query_time_ms": 904
    })
    print("   Metrics logged")

    # Log artifacts (example trace)
    print("\n5. Logging artifacts...")
    example_trace = {
        "query": "stainless steel pipe",
        "step1_output": {"core_concept": "piping", "material": "stainless steel"},
        "step2_candidates": ["stainless piping", "steel pipe"],
        "step3_ranking": ["stainless piping", "steel pipe"],
        "expected": "stainless piping",
        "actual": "stainless piping",
        "correct": True
    }
    registry.log_artifact(run_id, "traces/example_trace.json", example_trace)
    print("   Artifacts logged")

    # Finish run
    print("\n6. Finishing run...")
    registry.finish_run(run_id, RunStatus.FINISHED)
    print("   Run finished")

    # Retrieve and display run
    print("\n7. Retrieving run...")
    run = registry.get_run(run_id)
    print(f"   Run Name: {run.info.run_name}")
    print(f"   Status: {run.info.status}")
    print(f"   Parameters: {run.data.parameters}")
    print(f"   Metrics: {run.data.metrics}")

    print("\n" + "=" * 60)
    print("Example completed successfully!")
    print("=" * 60)

if __name__ == "__main__":
    main()
