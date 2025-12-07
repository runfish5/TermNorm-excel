# Prompt Optimization Strategy

**Goal**: Systematic prompt optimization using task/trace/config architecture.

**See also**:
- [LANGFUSE_DATA_MODEL.md](./LANGFUSE_DATA_MODEL.md) - Core data model
- [FILE_ORGANIZATION_STRATEGY.md](./FILE_ORGANIZATION_STRATEGY.md) - File formats

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    TERMNORM BACKEND (Production)                │
│  Web Research → Entity Profiling → Token Matching → LLM Ranking │
│                                                                 │
│  Logs: activity.jsonl, traces/, match_database.json             │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                   [Trace Data Flow]
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│              OPTIMIZATION SERVICE (Separate FastAPI)            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Tasks + Ground Truth (datasets/tasks/)              │      │
│  │  → Updated by UserChoice corrections                 │      │
│  └──────────────────────────────────────────────────────┘      │
│                            ↕                                    │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Config Tree (configs/nodes/)                        │      │
│  │  → Experiment variants with parent-child relationships│      │
│  └──────────────────────────────────────────────────────┘      │
│                            ↕                                    │
│  ┌──────────────────────────────────────────────────────┐      │
│  │  Traces (experiments/{exp}/{run}/traces/)            │      │
│  │  → Each attempt linked to task_id + config_id        │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. Tasks = Ground Truth
```json
{
  "id": "task_abc123",
  "input": {"query": "bollow gold"},
  "expected_output": {"target": "EUR-flat pallet"},
  "linked_traces": ["trace_001", "trace_002", "trace_003"]
}
```
- Created when query first seen
- `expected_output` starts null
- Updated when UserChoice provides correction
- Linked to all traces that attempted this task

### 2. Config Tree = Experiment Variants
```
1.0.0 (root)
├── websearch: brave_v1
├── profile_llm: prompt_v1, llama-70b
├── ranking: token_match_v1
│
├─► 1.1.0 (changed profile prompt)
│   └── profile_llm: prompt_v2
│
└─► 1.2.0 (changed websearch)
    └── websearch: serper_v1
```
- Each node differs from parent by one or more changes
- `diff_from_parent` tracks what changed
- Enables "which change helped?" analysis

### 3. Traces = Attempts
```json
{
  "id": "trace_001",
  "task_id": "task_abc123",
  "config_id": "1.0.0",
  "input": {"query": "bollow gold"},
  "output": {"target": "Steel sheet", "confidence": 0.72},
  "observations": [...]
}
```
- Links task (what) + config (how)
- Scored when ground truth arrives

---

## Optimization Flow

```
1. User enters query
   → get_or_create_task(query)

2. Pipeline runs
   → create trace linked to task + current config

3. User clicks Apply (UserChoice)
   → update_ground_truth(task_id, target)
   → re-score all linked traces

4. Analysis
   → Which config branch performs best?
   → Which component change had biggest impact?
```

---

## Multi-Stage Pipeline

Each trace contains stages (observations), each with its own config:

```
Trace for "bollow gold":
├── fuzzy_threshold (config: threshold=0.7)
├── web_search (config: provider=brave, version=v1)
├── profile_building (config: prompt=v2, model=llama-70b)
├── ranking (config: algorithm=token_match_v1)
└── llm_reranking (config: prompt=v1, model=llama-70b)
```

When ground truth arrives, can analyze:
- Which stage failed?
- Which prompt version performs better?
- What parameters need tuning?

---

## Metrics

| Metric | Description |
|--------|-------------|
| MRR | Mean Reciprocal Rank (1/rank of expected) |
| Hit@K | Expected in top K results |
| NDCG@K | Normalized Discounted Cumulative Gain |
| Latency | Total pipeline time (ms) |

```python
def calculate_mrr(results):
    return sum(1/r["rank"] if r["rank"] else 0 for r in results) / len(results)
```

---

## Implementation Status

### Already Implemented
- `standards_logger.py`: TraceLogger, ExperimentManager, RunManager
- `logs/prompts/`: Versioned prompt registry
- `logs/experiments/`: MLflow-compatible trace storage

### To Implement
- `DatasetManager`: Task storage with ground truth
- `ConfigTreeManager`: Config variant tree
- `/log-activity` enhancement: Update ground truth on UserChoice
- Re-evaluation: Score traces when ground truth changes

See implementation plan in [../docs/LANGFUSE_DATA_MODEL.md](./LANGFUSE_DATA_MODEL.md).

---

## Future: Framework Adoption

Current architecture enables migration to:

| Framework | What We Use | Migration Effort |
|-----------|-------------|------------------|
| MLflow | Experiments, runs, artifacts | Zero - format compatible |
| Langfuse | Traces, observations, scores | Zero - format compatible |
| DSPy | Module wrappers, optimization | Wrap pipeline as DSPy Module |

```bash
# When ready
pip install mlflow langfuse dspy-ai
mlflow.set_tracking_uri("file:./logs/experiments")
# Existing data immediately visible
```

---

*Document Version: 3.0 (Condensed)*
*Standards Compliance: MLflow ✅ | Langfuse ✅*
