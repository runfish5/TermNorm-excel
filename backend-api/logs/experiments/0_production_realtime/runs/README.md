# Production Realtime Runs

Runs for the `0_production_realtime` experiment.

## Naming Convention

`production_YYYY-MM-DD` - One run per day, reused on server restart

## Run Contents

```
<run_id>/
├── meta.yaml                          # Name, status (RUNNING/FINISHED), timestamps
├── params.json                        # LLM provider, model, temperature, pipeline version
├── tags.json                          # Source, date, logging_mode
├── metrics.json                       # Avg confidence/latency, method breakdown
└── artifacts/
    ├── evaluation_results.jsonl       # One line per query (query, predicted, method, confidence, latency, timestamp)
    └── traces/<trace_id>.json         # Observations (web search, entity profiling, LLM ranking)
```

## Git Strategy

**Example run `2fc6fe2a/`:**
- ✅ Versioned: `meta.yaml`, `params.json`, `tags.json`, `metrics.json`, `.gitkeep`
- ❌ Ignored: `evaluation_results.jsonl`, `traces/*.json`

All other runs ignored. Local dev data in `1_production_historical/` fully ignored.
