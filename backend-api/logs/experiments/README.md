# Experiments Directory

MLflow-compatible experiment tracking for TermNorm research and evaluation.

## Default: `0_production_realtime`

Automatically logs all live matches:
- One run per day (`production_YYYY-MM-DD`)
- Persists across server restarts

## Directory Structure

```
<experiment_id>/
├── meta.yaml                      # Experiment metadata
├── tags/                          # Experiment-level tags
├── traces/                        # MLflow FileStore traces (for MLflow UI)
│   └── <trace_id>/
│       ├── trace_info.yaml        # Trace metadata (query, response, timing)
│       ├── artifacts/traces.json  # Span data (pipeline steps)
│       ├── request_metadata/      # experiment_id, run_id, session_id
│       └── tags/                  # mlflow.traceName, score.confidence, etc.
│
└── <run_id>/                      # One run per day (production_YYYY-MM-DD)
    ├── meta.yaml                  # Run metadata (required MLflow fields)
    ├── params/                    # Hyperparameters (individual files)
    ├── tags/                      # Run tags (individual files)
    ├── metrics/                   # Metrics (timestamp value step format)
    └── artifacts/
        ├── evaluation_results.jsonl  # Summary file (for debugging)
        └── traces/                    # Langfuse-style JSON traces
            └── trace-<id>.json
```

## Dual Trace Storage

Traces are stored in **two formats** for different purposes:

| Location | Format | Purpose |
|----------|--------|---------|
| `traces/<id>/` | MLflow FileStore | **MLflow UI** - native trace viewer |
| `<run_id>/artifacts/traces/trace-<id>.json` | Langfuse JSON | **Debugging** - full trace in single file |

Both contain the same data, just structured differently.

## evaluation_results.jsonl

A summary file for quick debugging without opening individual traces:

```jsonl
{"query": "green copper", "predicted": "Wire drawing, copper...", "method": "ProfileRank", "confidence": 0.85, "latency_ms": 12500, "trace_id": "trace-abc123"}
```

**Fields:** query, predicted, method, confidence, latency_ms, timestamp, session_id, trace_id

## Logged Data

Query, predicted identifier, method (cache/fuzzy/LLM), confidence, latency, timestamp, trace details (web search, entity profiling, LLM ranking)

**Standards:** MLflow (experiments/prompts), Langfuse (traces), DSPy (eval format)

## View in MLflow UI

```bash
pip install mlflow
mlflow ui --backend-store-uri "file:///C:/Users/dsacc/OfficeAddinApps/TermNorm-excel/backend-api/logs/experiments" --port 5001
```

Open http://localhost:5001 to browse experiments, runs, metrics, and traces.
