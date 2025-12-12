# Experiments API

Read-only API for accessing TermNorm's experiment data (MLflow-compatible format).

**Use case**: External evaluation/optimization servers fetch experiment runs and traces for analysis, evaluation, and prompt optimization.

---

## Base URL

```
http://{host}:8000/experiments
```

Default local: `http://localhost:8000/experiments`

---

## Endpoints

### GET /experiments

List all experiments.

**Response:**

```json
{
  "experiments": [
    {
      "experiment_id": "0_production_realtime",
      "name": "production_realtime",
      "description": "",
      "artifact_location": "logs/experiments/0_production_realtime",
      "lifecycle_stage": "active",
      "creation_time": 1733312345000,
      "last_update_time": 1733312345000,
      "num_runs": 4
    }
  ],
  "total": 1
}
```

**Example:**

```bash
curl http://localhost:8000/experiments
```

---

### GET /experiments/{experiment_id}

Get experiment details with all runs.

**Response:**

```json
{
  "experiment": {
    "experiment_id": "0_production_realtime",
    "name": "production_realtime",
    ...
  },
  "runs": [
    {
      "run_id": "251208083232ecd6ba65905f4224908d",
      "run_name": "...",
      "status": 3,
      "start_time": 1733647952000,
      "params": { "model": "llama-3.3-70b" },
      "metrics": { "avg_confidence": 0.85 },
      "tags": { "mlflow.runName": "..." }
    }
  ],
  "total_runs": 4
}
```

---

### GET /experiments/{experiment_id}/runs

List runs with pagination.

**Query Parameters:**

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `limit` | int | 50 | 200 | Number of results |
| `offset` | int | 0 | - | Skip N results |

**Response:**

```json
{
  "runs": [...],
  "total": 4,
  "limit": 50,
  "offset": 0
}
```

---

### GET /experiments/{experiment_id}/runs/{run_id}

Get full run details including params, metrics, tags, and artifacts list.

**Response:**

```json
{
  "run": {
    "run_id": "251208083232ecd6ba65905f4224908d",
    "run_name": "production_run",
    "experiment_id": "0_production_realtime",
    "status": 3,
    "start_time": 1733647952000,
    "end_time": 1733648000000,
    "params": {
      "model": "groq/llama-3.3-70b",
      "prompt_version": "v1"
    },
    "metrics": {
      "avg_confidence": 0.85,
      "total_traces": 25
    },
    "tags": {
      "mlflow.runName": "production_run"
    },
    "artifacts": ["traces.json", "evaluation_results.jsonl"]
  }
}
```

---

### GET /experiments/{experiment_id}/traces

List all traces in an experiment.

**Query Parameters:**

| Param | Type | Default | Max | Description |
|-------|------|---------|-----|-------------|
| `limit` | int | 100 | 500 | Number of results |
| `offset` | int | 0 | - | Skip N results |

**Response:**

```json
{
  "traces": [
    {
      "trace_id": "25120808413195b7be2d0c5749918503",
      "request_time": "2025-12-08T08:41:31Z",
      "execution_duration_ms": 8140,
      "state": "OK",
      "request_preview": "{\"query\": \"mexican alu\"}",
      "response_preview": "{\"target\": \"Aluminium...\", \"confidence\": 0.95}",
      "tags": {
        "mlflow.traceName": "termnorm_pipeline",
        "score.confidence": "0.95"
      }
    }
  ],
  "total": 50,
  "limit": 100,
  "offset": 0
}
```

---

### GET /experiments/{experiment_id}/traces/{trace_id}

Get full trace details including spans.

**Response:**

```json
{
  "trace": {
    "trace_id": "25120808413195b7be2d0c5749918503",
    "request_time": "2025-12-08T08:41:31Z",
    "execution_duration_ms": 8140,
    "state": "OK",
    "request_metadata": {
      "experiment_id": "0_production_realtime",
      "session_id": "admin",
      "run_id": "251208083232ecd6ba65905f4224908d"
    },
    "tags": {
      "mlflow.traceName": "termnorm_pipeline",
      "mlflow.traceInputs": "{\"query\": \"mexican alu\"}",
      "mlflow.traceOutputs": "{\"target\": \"Aluminium...\"}",
      "score.confidence": "0.95"
    },
    "spans": [
      {
        "span_id": "251208084131abcd",
        "trace_id": "25120808413195b7be2d0c5749918503",
        "parent_id": null,
        "name": "termnorm_pipeline",
        "span_type": "CHAIN",
        "start_time_ns": 1733647291000000000,
        "end_time_ns": 1733647299140000000,
        "inputs": {"query": "mexican alu"},
        "outputs": {"target": "Aluminium...", "confidence": 0.95}
      },
      {
        "span_id": "251208084132efgh",
        "parent_id": "251208084131abcd",
        "name": "web_search",
        "span_type": "CHAIN",
        ...
      },
      {
        "span_id": "251208084135ijkl",
        "parent_id": "251208084131abcd",
        "name": "entity_profiling",
        "span_type": "LLM",
        ...
      }
    ]
  }
}
```

---

### GET /experiments/{experiment_id}/traces/{trace_id}/langfuse

Get trace in Langfuse-compatible JSON format (from run artifacts).

**Response:**

```json
{
  "trace": {
    "id": "25120808413195b7be2d0c5749918503",
    "name": "termnorm_pipeline",
    "input": {"query": "mexican alu"},
    "output": {"target": "Aluminium...", "method": "ProfileRank", "confidence": 0.95},
    "observations": [
      {"id": "obs-abc123", "type": "span", "name": "web_search", ...},
      {"id": "obs-def456", "type": "generation", "name": "entity_profiling", ...}
    ],
    "scores": [
      {"name": "confidence", "value": 0.95},
      {"name": "latency_ms", "value": 8140}
    ]
  },
  "format": "langfuse"
}
```

---

## Data Storage Structure

```
logs/experiments/
└── 0_production_realtime/           # Experiment
    ├── meta.yaml                    # Experiment metadata
    ├── traces/                      # MLflow traces (indexed)
    │   └── {trace_id}/
    │       ├── trace_info.yaml
    │       ├── request_metadata/
    │       ├── tags/
    │       └── artifacts/traces.json
    └── {run_id}/                    # Runs with params/metrics
        ├── meta.yaml
        ├── params/
        ├── metrics/
        ├── tags/
        └── artifacts/
            └── traces/
                └── trace-{id}.json  # Langfuse format
```

---

## Integration with Evaluation Server

External servers can:

1. **List experiments** to see available data sources
2. **Fetch traces** for evaluation datasets
3. **Get detailed traces** with observations for analysis
4. **Access run metrics** to compare optimization iterations

Example workflow:

```python
import requests

BASE = "http://localhost:8000/experiments"

# 1. Get all experiments
experiments = requests.get(BASE).json()

# 2. Get traces from production experiment
traces = requests.get(f"{BASE}/0_production_realtime/traces").json()

# 3. Get full trace with spans
trace = requests.get(f"{BASE}/0_production_realtime/traces/{trace_id}").json()

# 4. Get detailed trace with observations
detailed = requests.get(f"{BASE}/0_production_realtime/traces/{trace_id}/langfuse").json()
```
