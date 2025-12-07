# Langfuse-Compatible Data Model Specification

**Dual Format Support**: This spec extends the existing MLflow-compatible structure.
- **MLflow**: `logs/experiments/` - Experiment tracking, runs, artifacts (already working)
- **Langfuse**: `logs/datasets/`, `logs/configs/` - Task ground truth, config variants
- **Both**: Traces output to both formats via `standards_logger.py`

**See also**: [FILE_ORGANIZATION_STRATEGY.md](./FILE_ORGANIZATION_STRATEGY.md) for file formats.

---

## Core Concepts

### 1. TASK = Dataset Item
The mapping you're trying to resolve.

```
Task: "bollow gold" → ?
├── expected_output: null (unknown)
│     ↓ [UserChoice]
└── expected_output: "EUR-flat pallet"
```

### 2. TRACES = Attempts
Each pipeline run is an attempt to solve a task.

```
Task: "bollow gold"
├── trace_001 (config 1.0.0) → "Steel sheet"
├── trace_002 (config 1.1.0) → "EUR-flat pallet" ✓
└── trace_003 (config 1.2.0) → "Pallet wood"
```

### 3. CONFIG TREE = Experiment Variants
Hierarchical tree of configuration variants. Each node differs from parent by one or more component changes.

```
1.0.0 (root)
├── websearch: brave_v1
├── profile_llm: prompt_v1, llama-70b
├── ranking: token_match_v1
└── rerank_llm: prompt_v1, llama-70b
    │
    ├──► 1.1.0 (changed: profile_llm.prompt → v2)
    │    │
    │    ├──► 1.1.1 (changed: profile_llm.model → llama-90b)
    │    └──► 1.1.2 (changed: ranking → token_match_v2)
    │
    └──► 1.2.0 (changed: websearch → serper_v1)
         │
         └──► 1.2.1 (changed: profile_llm.prompt → v2)
```

### 4. MULTI-STAGE Pipeline
Each trace contains multiple stages, each with its own input/output/config:

```
Trace for "bollow gold":
├── Stage: fuzzy_threshold
│   └── output: {match: null, score: 0.3}
│
├── Stage: web_search
│   ├── config: {provider: "brave", version: "v1"}
│   └── output: [{url, snippet}, ...]
│
├── Stage: profile_building
│   ├── config: {prompt: "entity_profiling", version: 2, model: "llama-70b"}
│   └── output: {core_concept: "pallet", features: [...]}
│
├── Stage: ranking_algorithm
│   ├── config: {algorithm: "token_match", version: "v1"}
│   └── output: [ranked_candidates...]
│
└── Stage: llm_reranking (optional)
    ├── config: {prompt: "llm_ranking", version: 1, model: "llama-70b"}
    └── output: [final_ranked_candidates...]
```

### 5. Ground Truth Propagation
When UserChoice provides final answer, evaluate backward:

```
Ground Truth: "EUR-flat pallet"
│
├── Final output correct? → score trace
├── Was "EUR-flat" in ranking output? → score ranking stage
├── Did profile relate to "pallet"? → score profile stage
└── Did web sources help? → score web_search stage
```

---

## Data Requirements

### What Langfuse Needs (file format)

1. **Traces** - Main execution records
2. **Observations** - Spans within traces (stages)
3. **Generations** - LLM calls (special observations)
4. **Scores** - Evaluation metrics
5. **Dataset Items** - Tasks with ground truth

### What We Already Have

- `logs/experiments/` - Trace storage (MLflow format)
- `logs/prompts/` - Versioned prompts
- Traces with `observations` array (stages)

### What's Missing

- `logs/datasets/` - Task storage with ground truth
- `logs/configs/` - Config tree storage
- `task_id` on traces
- `config_id` on traces
- `config` object on each observation/stage

---

## File Structure

```
logs/
├── datasets/
│   └── tasks/
│       └── {task_id}.json
│
├── configs/
│   ├── tree.json           # Parent-child relationships
│   └── nodes/
│       └── {config_id}.json
│
├── experiments/            # Already exists
│   └── {exp}/{run}/
│       └── traces/
│           └── trace-{id}.json
│
└── prompts/                # Already exists
    └── {prompt_family}/
        └── {version}/prompt.txt
```

---

## Use Cases

### 1. Score traces when ground truth arrives
```
UserChoice("bollow gold" → "EUR-flat pallet")
  → Find all traces for task
  → Score each: output == expected ? 1 : 0
  → Aggregate by config_id to find winning branch
```

### 2. Compare config branches
```
SELECT config_id, AVG(score) as accuracy
FROM traces
WHERE task.has_ground_truth = true
GROUP BY config_id
ORDER BY accuracy DESC
```

### 3. Identify which component change helped
```
Config 1.0.0: 45% accuracy
Config 1.1.0: 82% accuracy (+37%)
  └── diff: profile_llm.prompt v1 → v2

Conclusion: prompt_v2 was the key improvement
```

### 4. Re-run historical tasks with new config
```
For all tasks with ground_truth:
  - Re-run input with config 1.3.0
  - Compare to historical scores
  - Measure improvement
```

---

## Future: Export to Langfuse Cloud

A separate FastAPI service can:
1. Read `logs/datasets/tasks/*.json`
2. Read `logs/experiments/**/traces/*.json`
3. Transform to Langfuse API format
4. Push to Langfuse Cloud

Minimal transformation needed because file format matches Langfuse concepts.
