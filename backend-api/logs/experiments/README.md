# Experiments Directory

MLflow-compatible experiment tracking for TermNorm research and evaluation.

## Default: `0_production_realtime`

Automatically logs all live matches:
- One run per day (`production_YYYY-MM-DD`)
- Persists across server restarts

## Structure Per Run

```
<run_id>/
├── meta.yaml                          # Run metadata
├── params.json, tags.json             # Hyperparameters, tags (versioned)
├── metrics.json                       # Aggregates (versioned)
├── artifacts/evaluation_results.jsonl # Query/prediction pairs (ignored)
└── traces/<trace_id>.json             # Execution details (ignored)
```

**Logged Data:** Query, predicted identifier, method (cache/fuzzy/LLM), confidence, latency, timestamp, trace details (web search, entity profiling, LLM ranking)

**Standards:** MLflow (experiments/prompts), Langfuse (traces), DSPy (eval format), GitHub Models (inference)
