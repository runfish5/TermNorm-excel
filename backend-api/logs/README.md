# Logs Directory

Runtime data, experiment results, and Langfuse-compatible logging for the TermNorm backend.

## Structure

```
logs/
├── match_database.json               # Cached identifier mappings
├── langfuse/                         # Langfuse-compatible structure
│   ├── events.jsonl                  # Flat log for quick reading (custom)
│   ├── traces/                       # Lean trace files (~10 lines each)
│   │   └── {trace_id}.json
│   ├── observations/{trace_id}/      # Verbose step data (separate files)
│   │   └── obs-{id}.json
│   ├── scores/                       # Scores linked to traces
│   │   └── {trace_id}.jsonl
│   └── datasets/                     # Ground truth items
│       └── termnorm_ground_truth/
│           └── item-{id}.json
└── prompts/                          # Versioned LLM prompts
    ├── entity_profiling/1/
    └── llm_ranking/1/
```

## Langfuse Data Model

| Entity | Location | Purpose |
|--------|----------|---------|
| Events | `langfuse/events.jsonl` | Flat log with trace_id/item_id for navigation |
| Traces | `langfuse/traces/` | Lean workflow summaries |
| Observations | `langfuse/observations/{trace_id}/` | Verbose step details |
| Scores | `langfuse/scores/` | Evaluation metrics |
| Dataset Items | `langfuse/datasets/` | Ground truth for evaluation |

See [../docs/LANGFUSE_DATA_MODEL.md](../docs/LANGFUSE_DATA_MODEL.md) for full specification.

## Git Strategy

- **Versioned**: Structure (READMEs), prompts (all versions)
- **Ignored**: All runtime data (`langfuse/`, cache files)

## Data Flow

1. User Query → Frontend (cache + fuzzy matching)
2. LLM Pipeline → Backend `/research-and-match`
3. Langfuse Logging → `log_pipeline()` creates trace + observations + dataset item + event
4. User Correction → `log_user_correction()` updates ground truth + logs event
