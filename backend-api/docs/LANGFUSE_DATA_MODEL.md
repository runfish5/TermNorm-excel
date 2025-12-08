# Langfuse-Compatible Data Model

TermNorm implements the official Langfuse data model for observability and evaluation.

**Implementation**: `utils/langfuse_logger.py`

---

## Directory Structure

```
logs/langfuse/
├── events.jsonl                      # Flat log for easy reading (custom)
├── traces/                           # Lean trace files (~10 lines)
│   └── {trace_id}.json
├── observations/{trace_id}/          # Verbose details (separate files)
│   ├── obs-xxx.json                  # web_search span
│   ├── obs-yyy.json                  # entity_profiling generation
│   ├── obs-zzz.json                  # token_matching span
│   └── obs-www.json                  # llm_ranking generation
├── scores/
│   └── {trace_id}.jsonl              # Scores linked to traces
└── datasets/{dataset_name}/          # Ground truth items
    └── item-{id}.json
```

---

## Core Entities

### 1. Traces (Lean)

Top-level workflow records. Deliberately minimal for readability.

```json
{
  "id": "251208143052a7b8c9d0...",
  "name": "termnorm_pipeline",
  "timestamp": "2025-12-08T14:30:52Z",
  "input": {"query": "mexican alu"},
  "output": {
    "target": "Aluminium, wrought alloy {GLO}...",
    "method": "ProfileRank",
    "confidence": 0.95
  },
  "user_id": "admin",
  "session_id": "admin",
  "metadata": {"llm_provider": "groq/llama-3.3-70b"},
  "tags": ["production"]
}
```

### 2. Observations (Verbose, Separate Files)

Each pipeline step stored in its own file, linked via `trace_id`.

**Types:**
- `span` - Generic operations (web_search, token_matching)
- `generation` - LLM calls with model/usage fields
- `event` - Point-in-time occurrences (user_correction)

```json
// observations/{trace_id}/obs-abc123.json
{
  "id": "obs-abc123",
  "trace_id": "251208143052a7b8c9d0...",
  "type": "generation",
  "name": "entity_profiling",
  "start_time": "2025-12-08T14:30:52Z",
  "end_time": "2025-12-08T14:30:58Z",
  "model": "groq/llama-3.3-70b",
  "input": {
    "query": "mexican alu",
    "web_sources": [{"title": "...", "url": "..."}]
  },
  "output": {
    "entity_name": "Mexican Aluminium",
    "core_concept": "Import",
    "distinguishing_features": ["Aluminium", "Mexican origin", ...],
    "alternative_names": ["Mexican Aluminum", ...],
    ...
  },
  "level": "DEFAULT",
  "metadata": {}
}
```

### 3. Scores

Evaluation metrics linked to traces.

```json
// scores/{trace_id}.jsonl
{"id": "score-001", "trace_id": "...", "name": "confidence", "value": 0.95, "data_type": "NUMERIC"}
{"id": "score-002", "trace_id": "...", "name": "latency_ms", "value": 8140, "data_type": "NUMERIC"}
```

### 4. Dataset Items (Ground Truth)

Items link TO traces via `source_trace_id` (Langfuse convention).

```json
// datasets/termnorm_ground_truth/item-xxx.json
{
  "id": "item-251208143052...",
  "dataset_name": "termnorm_ground_truth",
  "input": {"query": "mexican alu"},
  "expected_output": {"target": "riggid term"},
  "source_trace_id": "251208143052a7b8c9d0...",
  "metadata": {
    "created_at": "2025-12-08T14:30:52Z",
    "ground_truth_at": "2025-12-08T14:35:00Z"
  },
  "status": "ACTIVE"
}
```

---

## Data Flow

### Pipeline Execution
```
User Query: "mexican alu"
         ↓
    log_to_langfuse()
         ↓
    ┌────────────────────────────────────┐
    │ 1. Create TRACE (lean)             │
    │ 2. Create DATASET ITEM (linked)    │
    │ 3. Add OBSERVATIONS (verbose):     │
    │    - web_search (span)             │
    │    - entity_profiling (generation) │
    │    - token_matching (span)         │
    │    - llm_ranking (generation)      │
    │ 4. Add SCORES (confidence, latency)│
    │ 5. Complete trace                  │
    └────────────────────────────────────┘
```

### User Correction (Ground Truth)
```
UserChoice/DirectEdit: "riggid term"
         ↓
    log_user_correction()
         ↓
    ┌────────────────────────────────────┐
    │ 1. Find dataset item by query      │
    │ 2. Set expected_output             │
    │ 3. Add user_correction EVENT       │
    │ 4. Update trace output             │
    └────────────────────────────────────┘
```

---

## Langfuse Compatibility

| Langfuse Concept | TermNorm Implementation |
|------------------|------------------------|
| Trace | `traces/{trace_id}.json` |
| Observation | `observations/{trace_id}/*.json` |
| Generation | Observation with `type: "generation"`, has `model` field |
| Span | Observation with `type: "span"` |
| Event | Observation with `type: "event"` |
| Score | `scores/{trace_id}.jsonl` |
| Dataset Item | `datasets/{name}/{item_id}.json` |
| `source_trace_id` | Links items TO originating traces |

---

## API Usage

```python
from utils.langfuse_logger import log_pipeline, log_user_correction

# Log full pipeline result (creates trace, observations, scores, dataset item)
trace_id = log_pipeline(record, session_id="admin")

# Log user correction (updates ground truth + trace)
log_user_correction(source="mexican alu", target="selected term", method="UserChoice")
```

### Low-level functions (if needed)
```python
from utils.langfuse_logger import (
    create_trace, update_trace, get_trace,
    create_observation, create_score,
    get_or_create_item, set_ground_truth, get_item_by_query
)
```

---

## events.jsonl (Custom Extension)

A flat log for human readability and debugging. **Not part of Langfuse spec** but includes IDs for navigation.

```jsonl
{"event": "pipeline", "trace_id": "251208...", "item_id": "item-251208...", "query": "mexican alu", "target": "Aluminium...", "method": "ProfileRank", "confidence": 0.85, "session_id": "admin", "timestamp": "2025-12-08T09:15:16Z"}
{"event": "UserChoice", "trace_id": "251208...", "item_id": "item-251208...", "query": "mexican alu", "target": "Gold {GLO}...", "timestamp": "2025-12-08T09:17:45Z"}
{"event": "DirectEdit", "trace_id": null, "item_id": "item-251208...", "query": "new term", "target": "User typed", "timestamp": "2025-12-08T09:20:00Z"}
```

Navigate from any event:
- `trace_id` → `traces/{trace_id}.json`, `observations/{trace_id}/`, `scores/{trace_id}.jsonl`
- `item_id` → `datasets/termnorm_ground_truth/{item_id}.json`

---

## Benefits of This Structure

1. **Readable traces** - No 800-line JSON files
2. **Langfuse-compatible** - Can export to Langfuse Cloud
3. **Proper linking** - Items link TO traces (not reverse)
4. **Evaluation-ready** - Ground truth stored with items
5. **Separate concerns** - Lean traces, verbose observations
6. **Flat event log** - Quick overview via events.jsonl
