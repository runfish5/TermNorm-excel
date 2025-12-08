# Prompt Optimization Strategy

**Goal**: Systematic prompt optimization using Langfuse-compatible task/trace/observation architecture.

**See also**: [LANGFUSE_DATA_MODEL.md](./LANGFUSE_DATA_MODEL.md) - Data model details

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    TERMNORM BACKEND (Production)                │
│  Web Research → Entity Profiling → Token Matching → LLM Ranking │
│                                                                 │
│  Logging: utils/langfuse_logger.py                              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                   [Langfuse Data Model]
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│              logs/langfuse/                                     │
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  traces/                                             │      │
│  │  → Lean workflow summaries (input/output)            │      │
│  └──────────────────────────────────────────────────────┘      │
│                            ↕                                    │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  observations/{trace_id}/                            │      │
│  │  → Detailed step data (web_search, llm_ranking, etc) │      │
│  └──────────────────────────────────────────────────────┘      │
│                            ↕                                    │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  datasets/termnorm_ground_truth/                     │      │
│  │  → Items with expected_output (ground truth)         │      │
│  │  → source_trace_id links TO originating trace        │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. Dataset Items = Ground Truth

```json
{
  "id": "item-251208143052...",
  "dataset_name": "termnorm_ground_truth",
  "input": {"query": "bollow gold"},
  "expected_output": {"target": "EUR-flat pallet"},
  "source_trace_id": "251208143052a7b8c9d0...",
  "status": "ACTIVE"
}
```

- Created when query first seen (via pipeline)
- `expected_output` starts null
- Updated when UserChoice/DirectEdit provides correction
- `source_trace_id` links TO the originating trace (Langfuse convention)

### 2. Traces = Workflow Attempts (Lean)

```json
{
  "id": "251208143052a7b8c9d0...",
  "name": "termnorm_pipeline",
  "input": {"query": "bollow gold"},
  "output": {"target": "Steel sheet", "confidence": 0.72},
  "user_id": "admin",
  "metadata": {"llm_provider": "groq/llama-3.3-70b"},
  "tags": ["production"]
}
```

- Lean summary (no verbose data)
- Links to observations for detailed step data
- Scored when ground truth arrives

### 3. Observations = Pipeline Steps (Verbose)

```
observations/{trace_id}/
├── obs-xxx.json  (web_search - span)
├── obs-yyy.json  (entity_profiling - generation)
├── obs-zzz.json  (token_matching - span)
└── obs-www.json  (llm_ranking - generation)
```

- Separate files per step (readable!)
- Verbose data here (entity profiles, candidate lists)
- `generation` type has `model` field for LLM calls

---

## Optimization Flow

```
1. User enters query
   → log_to_langfuse() creates:
     - Trace (lean)
     - Dataset item (linked via source_trace_id)
     - Observations (verbose steps)
     - Scores (confidence, latency)

2. Pipeline runs, results displayed

3. User clicks Apply (UserChoice) or types directly (DirectEdit)
   → log_user_correction() updates:
     - Dataset item expected_output (ground truth)
     - Trace output
     - Adds user_correction event observation

4. Analysis (future)
   → Compare traces for same query
   → Which model/prompt performed best?
```

---

## Multi-Stage Pipeline

Each trace has observations for each stage:

```
Trace: "bollow gold"
├── web_search (span)
│   └── output: {sources: [...], count: 5}
├── entity_profiling (generation)
│   └── output: {entity_name: "...", core_concept: "...", ...}
├── token_matching (span)
│   └── output: {candidates: [...], count: 20}
└── llm_ranking (generation)
    └── output: {ranked_candidates: [...], top_candidate: "..."}
```

When ground truth arrives, can analyze:
- Did the correct answer appear in candidates?
- Was the entity profile accurate?
- Which ranking model performed better?

---

## Metrics

| Metric | Description |
|--------|-------------|
| MRR | Mean Reciprocal Rank (1/rank of expected) |
| Hit@K | Expected in top K results |
| Latency | Total pipeline time (ms) |
| Confidence | Model's reported confidence |

---

## Implementation Status

### Implemented
- `langfuse_logger.py`: `log_pipeline()`, `log_user_correction()`, plus low-level functions
- Ground truth capture via UserChoice/DirectEdit
- Lean traces + separate observations

### Future
- Re-evaluation: Score historical traces when ground truth changes
- A/B testing: Compare different model/prompt configurations
- Export to Langfuse Cloud

---

## Framework Compatibility

| Framework | Status | Notes |
|-----------|--------|-------|
| Langfuse | ✅ Compatible | File structure matches Langfuse data model |
| MLflow | ⚠️ Legacy | Old `experiments/` structure still exists |

```python
# Current usage
from utils.langfuse_logger import get_logger
logger = get_logger()
trace_id = logger.trace(name="...", input={...})
```

---

*Document Version: 4.0 (Langfuse-compatible)*
