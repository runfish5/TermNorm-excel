"""
Example 2: Optimization Campaign with Trials

Demonstrates:
- Creating an optimization campaign
- Creating baseline trial
- Creating enhanced trials (branching)
- Tracking lineage
- Visualizing trial tree
"""

import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from registry import Registry, RunStatus

def main():
    # Initialize registry
    registry = Registry()

    print("=" * 60)
    print("Example 2: Optimization Campaign with Trials")
    print("=" * 60)

    # Create optimization campaign
    print("\n1. Creating optimization campaign...")
    campaign_id = registry.create_optimization_campaign(
        campaign_name="prompt_optimization_example",
        optimizer_algorithm="breadth_first_tree_search",
        target_metric="mrr",
        dataset_id="example_queries.test.v0",
        baseline_run_id=None,
        target_threshold=0.95,
        created_by="example_user"
    )
    print(f"   Created campaign: {campaign_id}")

    # Create baseline trial
    print("\n2. Creating baseline trial...")
    baseline_trial_id = registry.create_optimization_trial(
        campaign_id=campaign_id,
        trial_name="baseline_trial",
        parent_trial_ids=[],  # Root trial
        branch_reason="baseline evaluation",
        config={
            "step1_prompt": "extraction_v1",
            "step3_prompt": "reranker_v1",
            "model": "groq/llama-3.3-70b"
        },
        changes_from_parent={}
    )
    print(f"   Created baseline trial: {baseline_trial_id}")

    # Simulate evaluation
    print("   Running evaluation...")
    registry.log_metrics(baseline_trial_id, {
        "mrr": 0.78,
        "hit@5": 0.89,
        "ndcg@5": 0.82
    })
    registry.finish_run(baseline_trial_id)
    print("   Baseline trial complete: MRR=0.78")

    # Create enhanced step1 trial (branch from baseline)
    print("\n3. Creating enhanced step1 trial...")
    step1_trial_id = registry.create_optimization_trial(
        campaign_id=campaign_id,
        trial_name="enhanced_step1_trial",
        parent_trial_ids=[baseline_trial_id],
        branch_reason="improve step1 extraction accuracy",
        config={
            "step1_prompt": "extraction_v2",  # Enhanced
            "step3_prompt": "reranker_v1",     # Inherited
            "model": "groq/llama-3.3-70b"
        },
        changes_from_parent={
            "step1_prompt": {
                "old": "extraction_v1",
                "new": "extraction_v2",
                "reason": "add explicit material extraction instruction"
            }
        }
    )
    print(f"   Created step1 trial: {step1_trial_id}")

    # Simulate evaluation
    print("   Running evaluation...")
    registry.log_metrics(step1_trial_id, {
        "mrr": 0.82,
        "hit@5": 0.91,
        "ndcg@5": 0.85
    })
    registry.finish_run(step1_trial_id)
    print("   Step1 trial complete: MRR=0.82 (improvement: +0.04)")

    # Create enhanced step3 trial (branch from baseline)
    print("\n4. Creating enhanced step3 trial...")
    step3_trial_id = registry.create_optimization_trial(
        campaign_id=campaign_id,
        trial_name="enhanced_step3_trial",
        parent_trial_ids=[baseline_trial_id],
        branch_reason="improve step3 reranking precision",
        config={
            "step1_prompt": "extraction_v1",   # Inherited
            "step3_prompt": "reranker_v2",     # Enhanced
            "model": "groq/llama-3.3-70b"
        },
        changes_from_parent={
            "step3_prompt": {
                "old": "reranker_v1",
                "new": "reranker_v2",
                "reason": "increase weight on core concept score"
            }
        }
    )
    print(f"   Created step3 trial: {step3_trial_id}")

    # Simulate evaluation
    print("   Running evaluation...")
    registry.log_metrics(step3_trial_id, {
        "mrr": 0.80,
        "hit@5": 0.90,
        "ndcg@5": 0.84
    })
    registry.finish_run(step3_trial_id)
    print("   Step3 trial complete: MRR=0.80 (improvement: +0.02)")

    # Create combined trial (merge best from both branches)
    print("\n5. Creating combined trial...")
    combined_trial_id = registry.create_optimization_trial(
        campaign_id=campaign_id,
        trial_name="combined_enhancements_trial",
        parent_trial_ids=[step1_trial_id, step3_trial_id],  # Multiple parents!
        branch_reason="merge improvements from step1 and step3 branches",
        config={
            "step1_prompt": "extraction_v2",   # From step1 branch
            "step3_prompt": "reranker_v2",     # From step3 branch
            "model": "groq/llama-3.3-70b"
        },
        changes_from_parent={
            "step1_prompt": {
                "source": "step1_trial",
                "change": "extraction_v1 -> extraction_v2"
            },
            "step3_prompt": {
                "source": "step3_trial",
                "change": "reranker_v1 -> reranker_v2"
            }
        }
    )
    print(f"   Created combined trial: {combined_trial_id}")

    # Simulate evaluation
    print("   Running evaluation...")
    registry.log_metrics(combined_trial_id, {
        "mrr": 0.89,
        "hit@5": 0.94,
        "ndcg@5": 0.90
    })
    registry.finish_run(combined_trial_id)
    print("   Combined trial complete: MRR=0.89 (improvement: +0.11)")

    # Visualize lineage
    print("\n6. Visualizing trial lineage...")
    print("\n" + "-" * 60)
    print(registry.visualize_lineage(campaign_id))
    print("-" * 60)

    # Get leaf trials (candidates for next branching)
    print("\n7. Finding leaf trials for next iteration...")
    leaf_trials = registry.get_leaf_trials(campaign_id)
    print(f"   Leaf trials: {len(leaf_trials)}")
    for trial_id in leaf_trials:
        run = registry.get_run(trial_id)
        mrr = run.data.metrics.get("mrr", 0.0)
        print(f"   - {run.info.run_name}: MRR={mrr:.2f}")

    print("\n" + "=" * 60)
    print("Example completed successfully!")
    print("=" * 60)

if __name__ == "__main__":
    main()
