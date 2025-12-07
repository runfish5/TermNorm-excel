# File Organization Strategy

**Goal**: Adopt MLflow + Langfuse-compatible file formats WITHOUT library dependencies.

**See also**: [LANGFUSE_DATA_MODEL.md](./LANGFUSE_DATA_MODEL.md) for task/config/trace architecture.

---

## Directory Structure

```
backend-api/logs/
├── experiments/                    # MLflow-compatible
│   └── {experiment_id}/
│       ├── meta.yaml               # Experiment metadata
│       └── {run_id}/
│           ├── meta.yaml           # Run metadata
│           ├── params/             # Key-value params
│           ├── metrics/            # Time-series metrics
│           ├── tags/               # Lineage tags
│           └── artifacts/
│               ├── traces/         # Langfuse-compatible traces
│               └── prompts/        # Prompt snapshots
│
├── datasets/                       # Ground truth (Langfuse-compatible)
│   └── tasks/
│       └── {task_id}.json
│
├── configs/                        # Config tree (experiment variants)
│   └── nodes/
│       └── {config_id}.json
│
├── prompts/                        # Prompt registry
│   └── {prompt_family}/
│       └── {version}/
│           ├── metadata.json
│           └── prompt.txt
│
├── activity.jsonl                  # Production telemetry (existing)
└── match_database.json             # Match cache (existing)
```

---

## MLflow Formats

### Experiment (`experiments/{id}/meta.yaml`)
```yaml
experiment_id: "1"
name: "improve_material_extraction"
lifecycle_stage: "active"
creation_time: 1733270100000
```

### Run (`experiments/{id}/{run_id}/meta.yaml`)
```yaml
run_id: "abc123"
run_name: "trial_001_baseline"
experiment_id: "1"
status: "FINISHED"
start_time: 1733270100000
end_time: 1733270400000
```

### Params/Metrics/Tags
- `params/{key}` - Single value per file
- `metrics/{key}` - Format: `timestamp step value`
- `tags/{key}` - Single value per file

---

## Langfuse Formats

### Trace (`artifacts/traces/{trace_id}/trace.json`)
```json
{
  "id": "trace-abc123",
  "name": "research-and-match",
  "task_id": "task_xyz",
  "config_id": "1.0.0",
  "input": {"query": "..."},
  "output": {"target": "...", "confidence": 0.95},
  "status": "SUCCESS"
}
```

### Observations (`observations.jsonl`)
```jsonl
{"id": "obs-1", "type": "span", "name": "web_search", "input": {...}, "output": {...}}
{"id": "obs-2", "type": "generation", "name": "entity_profiling", "model": "llama-70b", "config": {...}}
```

### Scores (`scores.jsonl`)
```jsonl
{"name": "confidence", "value": 0.95, "data_type": "NUMERIC"}
{"name": "latency_ms", "value": 1234, "data_type": "NUMERIC"}
```

---

## Implementation

All formats implemented in `utils/standards_logger.py`:

- `ExperimentManager` - MLflow experiment/run lifecycle
- `RunManager` - Params, metrics, tags, artifacts
- `TraceLogger` - Langfuse traces, observations, scores
- `DatasetManager` - Tasks with ground truth
- `ConfigTreeManager` - Experiment config variants

**No external dependencies** - pure Python with standard library + PyYAML.

---

## Migration Path

1. **Current state**: Production logs to `activity.jsonl` (unchanged)
2. **Add**: Standards-compatible structure for optimization
3. **Future**: Can adopt MLflow/Langfuse with zero data migration

```bash
# When ready to adopt MLflow
pip install mlflow
mlflow.set_tracking_uri("file:./logs/experiments")
mlflow ui  # Experiments visible immediately
```

---

*Standards Compliance: MLflow FileStore ✅ | Langfuse Trace Format ✅*
