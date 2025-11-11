# CLAUDE.md - Evaluation Framework

## Purpose

MLflow-based prompt optimization and pipeline quality monitoring.

## Key Principles

- **Direct Execution**: Run experiments without server - `python scripts/run_experiment.py`
- **Adapter Pattern**: One-line decorator integration - `@tracker.track_pipeline()`
- **Self-Hosted**: All data in `mlruns/` and `mlflow.db`, zero cloud deps
- **Monitorability**: MLflow UI at `localhost:5000` for all metrics/runs

## Structure

```
evaluation/
├── adapters/mlflow_adapter.py    # Tracking decorators
├── scripts/run_experiment.py     # Batch runner
├── metrics/ranking_quality.py    # MRR, NDCG, Hit@K
└── configs/test_datasets.json    # Test cases
```

## Quick Start

```bash
# Run experiment
python evaluation/scripts/run_experiment.py

# View results
mlflow ui --port 5000
```

## Integration (Optional)

```python
# In api/research_pipeline.py
from evaluation.adapters.mlflow_adapter import tracker

@router.post("/research-and-match")
@tracker.track_pipeline("research_and_match")  # Add this line
async def research_and_match(request, payload):
    # Existing code unchanged
```

## Tracked Metrics

- **Parameters**: query, llm_provider, llm_model, prompt_variant
- **Metrics**: MRR, Hit@K, NDCG@K, latency, top1_core_score
- **Artifacts**: pipeline_result.json, prompts

## Workflow

1. Extract test cases: `python scripts/extract_test_cases.py`
2. Run baseline: `python scripts/run_experiment.py --variant baseline`
3. Modify prompt, run variant: `--variant enhanced_v2`
4. Compare in MLflow UI, deploy winner

## Design

**Pragmatic**: Minimal code changes, maximum observability
**Stateless**: No session management, pure function tracking
**Protocol**: Industry-standard MLflow conventions
