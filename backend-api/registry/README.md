```markdown
# Experiment Registry System

Industry-standard experiment tracking infrastructure following **MLflow** and **OpenAI Evals** conventions.

## Overview

This registry system provides:

- **MLflow-compatible tracking**: Experiments, runs, parameters, metrics, tags, artifacts
- **OpenAI Evals datasets**: JSONL format with `<name>.<split>.<version>` naming
- **Parent-child runs**: Nested runs using `mlflow.parentRunId` pattern
- **Lineage tracking**: Trial relationship graphs for optimization workflows
- **Filesystem storage**: No database required, all data in structured files

## Architecture

```
registry/
├── schemas/                    # Pydantic models (MLflow/OpenAI Evals standards)
│   ├── run_schema.py          # Run, RunInfo, RunData, SystemTags
│   ├── experiment_schema.py   # Experiment, ExperimentMetadata
│   └── dataset_schema.py      # DatasetSample, DatasetMetadata
├── managers/                   # Specialized managers
│   ├── experiment_manager.py  # Experiment CRUD
│   ├── run_manager.py         # Run tracking (params, metrics, tags)
│   ├── lineage_manager.py     # Trial relationship graphs
│   └── dataset_manager.py     # Dataset CRUD (JSONL)
├── data/                       # Storage directory
│   ├── experiments/           # Experiment metadata
│   ├── runs/                  # Run data and artifacts
│   ├── datasets/              # JSONL dataset files
│   └── lineage/               # Lineage graphs
└── registry.py                # Main unified interface
```

## Quick Start

### Basic Evaluation Run

```python
from registry import Registry, ExperimentType, RunType

# Initialize
registry = Registry()

# Create experiment
experiment_id = registry.create_experiment(
    name="baseline_evaluation",
    experiment_type=ExperimentType.EVALUATION,
    description="Baseline prompt performance evaluation"
)

# Create run
run_id = registry.create_evaluation_run(
    experiment_id=experiment_id,
    run_name="baseline_v1_2025-01-15",
    dataset_id="termnorm_queries.test.v0",
    config={
        "model": "groq/llama-3.3-70b",
        "prompt_version": "v1",
        "temperature": 0.0
    }
)

# Log metrics
registry.log_metrics(run_id, {
    "mrr": 0.85,
    "hit@5": 0.92,
    "ndcg@5": 0.88
})

# Log artifacts (traces)
registry.log_artifact(run_id, "traces/query_001.json", trace_data)

# Finish run
registry.finish_run(run_id)
```

### Optimization Campaign with Trials

```python
from registry import Registry, DataSplit

registry = Registry()

# Create optimization campaign (parent run)
campaign_id = registry.create_optimization_campaign(
    campaign_name="prompt_optimization_jan_2025",
    optimizer_algorithm="breadth_first_tree_search",
    target_metric="mrr",
    dataset_id="termnorm_queries.test.v0",
    baseline_run_id="baseline-run-123",
    target_threshold=0.95
)

# Create baseline trial
baseline_trial_id = registry.create_optimization_trial(
    campaign_id=campaign_id,
    trial_name="baseline_trial",
    parent_trial_ids=[],  # Root trial
    branch_reason="baseline evaluation",
    config={
        "step1_prompt": "extraction_v1",
        "step3_prompt": "reranker_v1"
    },
    changes_from_parent={}
)

# Run evaluation, log metrics
registry.log_metrics(baseline_trial_id, {"mrr": 0.78})

# Create enhanced trial (branches from baseline)
enhanced_trial_id = registry.create_optimization_trial(
    campaign_id=campaign_id,
    trial_name="enhanced_step1_trial",
    parent_trial_ids=[baseline_trial_id],
    branch_reason="improve step1 extraction",
    config={
        "step1_prompt": "extraction_v2",  # Changed
        "step3_prompt": "reranker_v1"     # Inherited
    },
    changes_from_parent={
        "step1_prompt": {
            "old": "extraction_v1",
            "new": "extraction_v2",
            "reason": "add explicit material extraction"
        }
    }
)

# Run evaluation, log metrics
registry.log_metrics(enhanced_trial_id, {"mrr": 0.82})

# Visualize lineage
print(registry.visualize_lineage(campaign_id))
```

## Naming Conventions

### Run IDs
- **Format**: UUID (32-character hex string)
- **Example**: `9245396b47c94513bbf9a119b100aa47`
- **Standard**: MLflow convention

### Experiment IDs
- **Format**: UUID
- **Example**: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`
- **Standard**: MLflow convention

### Dataset IDs
- **Format**: `<name>.<split>.<version>`
- **Example**: `termnorm_queries.test.v0`
- **Components**:
  - `name`: Dataset identifier (e.g., `termnorm_queries`)
  - `split`: Data split (`train`, `val`, `test`, `dev`)
  - `version`: Version identifier (`v0`, `v1`, `v2`, ...)
- **Standard**: OpenAI Evals convention

### Run Names
- **Format**: Free-form, descriptive string
- **Example**: `baseline_v1_2025-01-15`
- **Best practice**: Include variant, date, or iteration number
- **Storage**: Stored as `mlflow.runName` tag

## Standard Fields

### Run Parameters (mlflow.log_param)
```python
{
    "model": "groq/llama-3.3-70b",
    "prompt_version": "v1",
    "temperature": 0.0,
    "step1_prompt": "extraction_v2",
    "step3_prompt": "reranker_v1"
}
```

### Run Metrics (mlflow.log_metric)
```python
{
    "mrr": 0.85,
    "hit@5": 0.92,
    "ndcg@5": 0.88,
    "total_time_seconds": 45.2,
    "avg_query_time_ms": 904
}
```

### System Tags (MLflow standard)
```python
{
    "mlflow.runName": "baseline_v1",
    "mlflow.parentRunId": "parent-run-id",  # For nested runs
    "mlflow.user": "user@example.com",
    "mlflow.source.name": "evaluation_script.py",
    "mlflow.source.type": "LOCAL"
}
```

## Dataset Format

### JSONL Structure (OpenAI Evals standard)
```jsonl
{"input": {"query": "stainless steel pipe", "terms": ["steel pipe", "stainless tube"]}, "ideal": "stainless piping", "metadata": {"category": "materials"}}
{"input": {"query": "aluminum tube", "terms": ["alu tube", "aluminum tubing"]}, "ideal": "aluminum tubing", "metadata": {"category": "materials"}}
```

### Creating Datasets
```python
from registry import Registry, DatasetSample, DataSplit

registry = Registry()

samples = [
    DatasetSample(
        input={"query": "stainless steel pipe", "terms": ["steel pipe", "stainless tube"]},
        ideal="stainless piping",
        metadata={"category": "materials"}
    ),
    # ... more samples
]

metadata = registry.create_dataset(
    name="termnorm_queries",
    split=DataSplit.TEST,
    version="v0",
    samples=samples,
    description="Test queries for TermNorm evaluation",
    created_by="user@example.com"
)
```

## Storage Structure

### On Disk
```
registry/data/
├── experiments/
│   ├── experiments_index.json                    # Fast lookup index
│   └── {experiment_id}/
│       ├── metadata.json                         # Experiment metadata
│       └── artifacts/                            # Experiment-level artifacts
│
├── runs/
│   └── {run_id}/
│       ├── run.json                              # RunInfo + RunData
│       ├── metadata.json                         # Extended metadata
│       ├── results.jsonl                         # Per-sample results
│       ├── metrics_summary.json                  # Aggregate metrics
│       └── artifacts/
│           ├── traces/
│           │   ├── query_001_trace.json
│           │   └── query_002_trace.json
│           └── other_artifacts.json
│
├── datasets/
│   ├── datasets_registry.json                    # Dataset index
│   └── {dataset_id}.jsonl                        # Dataset samples
│
└── lineage/
    └── {campaign_id}_lineage.json                # Trial relationship graph
```

### Run Metadata Example
```json
{
  "run_id": "9245396b-47c9-4513-bbf9-a119b100aa47",
  "run_type": "evaluation",
  "dataset_name": "termnorm_queries.test.v0",
  "dataset_path": "registry/data/datasets/termnorm_queries.test.v0.jsonl",
  "config": {
    "model": "groq/llama-3.3-70b",
    "prompt_version": "v1"
  },
  "parent_run_id": null
}
```

### Lineage Graph Example
```json
{
  "campaign_id": "campaign-123",
  "created_at": "2025-01-15T14:00:00",
  "trials": {
    "trial-001": {
      "trial_id": "trial-001",
      "parent_trial_ids": [],
      "children_trial_ids": ["trial-002", "trial-003"],
      "branch_reason": "baseline evaluation",
      "changes": {},
      "metrics": {"mrr": 0.78}
    },
    "trial-002": {
      "trial_id": "trial-002",
      "parent_trial_ids": ["trial-001"],
      "children_trial_ids": ["trial-004"],
      "branch_reason": "improve step1 extraction",
      "changes": {"step1_prompt": {"old": "v1", "new": "v2"}},
      "metrics": {"mrr": 0.82}
    }
  }
}
```

## Querying Runs

### Get Child Runs (Trials)
```python
# Get all trials in an optimization campaign
trials = registry.search_runs(parent_run_id=campaign_id)

for trial in trials:
    print(f"Trial: {trial.info.run_name}")
    print(f"  MRR: {trial.data.metrics.get('mrr')}")
    print(f"  Parent: {trial.data.tags.get('mlflow.parentRunId')}")
```

### Get Leaf Trials (for Next Branching)
```python
# Get trials that haven't been branched from yet
leaf_trial_ids = registry.get_leaf_trials(campaign_id)

for trial_id in leaf_trial_ids:
    run = registry.get_run(trial_id)
    print(f"Leaf trial: {run.info.run_name}, MRR: {run.data.metrics.get('mrr')}")
```

### Get Lineage Path
```python
lineage_data = registry.get_lineage(campaign_id)

# Trace ancestry
from registry.managers import LineageManager
lineage_mgr = LineageManager(registry.registry_root)
ancestors = lineage_mgr.get_ancestors(campaign_id, trial_id)
print(f"Ancestors: {ancestors}")
```

## Integration with Optimization Agents

### Optimization Agent Pattern
```python
def optimization_agent_workflow(registry, campaign_id):
    """Example optimization agent that reads registry and makes decisions."""

    # Get current state
    lineage = registry.get_lineage(campaign_id)
    leaf_trials = registry.get_leaf_trials(campaign_id)

    # Find best leaf trial
    best_trial_id = None
    best_mrr = 0.0

    for trial_id in leaf_trials:
        run = registry.get_run(trial_id)
        mrr = run.data.metrics.get("mrr", 0.0)
        if mrr > best_mrr:
            best_mrr = mrr
            best_trial_id = trial_id

    # Analyze failed cases from best trial
    run_dir = registry.registry_root / "runs" / best_trial_id
    traces_dir = run_dir / "artifacts" / "traces"

    failed_traces = []
    for trace_file in traces_dir.glob("*.json"):
        with open(trace_file) as f:
            trace = json.load(f)
            if not trace.get("metrics", {}).get("correct", True):
                failed_traces.append(trace)

    # Decide next optimization step
    if len(failed_traces) > 0:
        # Analyze failure patterns
        failure_analysis = analyze_failures(failed_traces)

        # Create new trial with modifications
        new_config = modify_config_based_on_failures(
            current_config=get_trial_config(registry, best_trial_id),
            failure_analysis=failure_analysis
        )

        new_trial_id = registry.create_optimization_trial(
            campaign_id=campaign_id,
            trial_name=f"optimized_trial_{len(lineage['trials'])+1}",
            parent_trial_ids=[best_trial_id],
            branch_reason=failure_analysis["branch_reason"],
            config=new_config,
            changes_from_parent=failure_analysis["changes"]
        )

        return new_trial_id
    else:
        print("Optimization target reached!")
        return None
```

## Compatibility with Existing Tools

### MLflow UI (Future)
The registry structure is compatible with MLflow's storage format. You can potentially import runs into MLflow UI for visualization.

### Custom Dashboards
```python
import pandas as pd

# Load all runs from an experiment
experiment_id = "exp-123"
runs = registry.search_runs(experiment_ids=[experiment_id])

# Create dataframe for analysis
df = pd.DataFrame([
    {
        "run_id": run.info.run_id,
        "run_name": run.info.run_name,
        "mrr": run.data.metrics.get("mrr"),
        "hit@5": run.data.metrics.get("hit@5"),
        "model": run.data.parameters.get("model"),
        "prompt_version": run.data.parameters.get("prompt_version")
    }
    for run in runs
])

print(df.sort_values("mrr", ascending=False))
```

## Best Practices

1. **Use descriptive names**: Include variant, date, or iteration in run names
2. **Log everything**: Parameters, metrics, and artifacts for full reproducibility
3. **Tag appropriately**: Use tags for filtering and grouping runs
4. **Document changes**: In optimization trials, always log `changes_from_parent`
5. **Track lineage**: For optimization, maintain lineage graph for traceability
6. **Version datasets**: Use `<name>.<split>.v{N}` for dataset versions
7. **Store traces**: Save detailed execution traces in artifacts for debugging

## References

- [MLflow Tracking](https://mlflow.org/docs/latest/tracking.html)
- [MLflow System Tags](https://mlflow.org/docs/latest/tracking.html#system-tags)
- [OpenAI Evals](https://github.com/openai/evals)
- [JSONL Format](https://jsonlines.org/)
```
