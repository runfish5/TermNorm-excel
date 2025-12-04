# Experiments Directory

MLflow-compatible experiment tracking for TermNorm research and evaluation.

## Default: `0_production_realtime`

Automatically logs all live matches:
- One run per day (`production_YYYY-MM-DD`)
- Persists across server restarts

## Structure Per Run (MLflow FileStore Format)

```
<run_id>/
├── meta.yaml                          # Run metadata
├── params/                            # Hyperparameters (individual files)
├── tags/                              # Tags (individual files)
├── metrics/                           # Metrics (timestamp value step format)
├── artifacts/evaluation_results.jsonl # Query/prediction pairs (ignored)
└── artifacts/traces/                  # Langfuse-style traces (ignored)

<experiment_id>/traces/<trace_id>/     # MLflow native traces (for MLflow UI)
├── trace_info.yaml
├── request_metadata/
├── tags/
└── artifacts/traces.json
```

**Logged Data:** Query, predicted identifier, method (cache/fuzzy/LLM), confidence, latency, timestamp, trace details (web search, entity profiling, LLM ranking)

**Standards:** MLflow (experiments/prompts), Langfuse (traces), DSPy (eval format), GitHub Models (inference)

## View in MLflow UI

```bash
pip install mlflow
mlflow ui --backend-store-uri "file:///C:/Users/dsacc/OfficeAddinApps/TermNorm-excel/backend-api/logs/experiments" --port 5001
```

Open http://localhost:5001 to browse experiments, runs, metrics, and traces.
