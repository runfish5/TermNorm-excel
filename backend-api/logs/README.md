# Logs Directory

Runtime data, experiment results, and configuration for the TermNorm backend.

## Structure

```
logs/
├── activity.jsonl                    # Legacy activity log (ignored)
├── match_database.json               # Cached identifier mappings (ignored)
├── match_database_metadata.json      # Cache metadata (ignored, see .example)
├── experiments/                      # MLflow-style experiment tracking
│   ├── 0_production_realtime/       # Default experiment (structure versioned)
│   └── 1_production_historical/     # Local dev data (fully ignored)
└── prompts/                         # Versioned LLM prompts (all committed)
    ├── entity_profiling/1/
    └── llm_ranking/1/
```

**Git Strategy:**
- ✅ Versioned: Structure (READMEs), prompts (all versions), example run `2fc6fe2a/`
- ❌ Ignored: `evaluation_results.jsonl`, `traces/*.json`, cache files, `1_production_historical/`

## Data Flow

1. User Query → Frontend (cache + fuzzy matching)
2. LLM Pipeline → Backend `/research-and-match`
3. Dual Logging → `activity.jsonl` + experiments structure
4. Cache Rebuild → Smart staleness detection on startup (see `cache_metadata.py`)
