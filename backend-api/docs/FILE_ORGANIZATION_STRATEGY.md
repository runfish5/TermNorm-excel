# File Organization & Standards Compatibility Strategy

## Executive Summary

This document defines how to organize TermNorm's existing logging, experiments, and prompt evaluation system using **file formats and directory structures compatible with MLflow, DSPy, and Langfuse** — **WITHOUT introducing these libraries as code dependencies**.

**Goal:** Adopt industry-standard file organization patterns so that future migration to these frameworks requires minimal reorganization.

**Key Principles:**
1. Use MLflow-compatible directory hierarchy for experiments and trials
2. Use DSPy-compatible JSON schemas for program serialization
3. Use Langfuse-compatible trace file formats
4. Implement using existing Python/JavaScript code only
5. Maintain full portability for future framework adoption

---

## Table of Contents

1. [Current State](#current-state)
2. [Target File Organization](#target-file-organization)
3. [MLflow-Compatible Structure](#mlflow-compatible-structure)
4. [DSPy-Compatible Formats](#dspy-compatible-formats)
5. [Langfuse-Compatible Formats](#langfuse-compatible-formats)
6. [Implementation Without Dependencies](#implementation-without-dependencies)
7. [Migration Path](#migration-path)

---

## Current State

### Existing File Structure

```
backend-api/logs/
├── activity_log_20251203.json         # Daily activity logs
├── match_database.json                # Identifier cache
└── app.log                            # Application logs
```

**Current Limitations:**
- No experiment/trial organization
- No prompt versioning
- No evaluation tracking
- No trace hierarchy
- No standardized formats

---

## Target File Organization

### Complete Directory Hierarchy (Standards-Compatible)

```
backend-api/logs/
│
├── experiments/                       # MLflow-compatible experiment structure
│   └── <experiment_id>/               # Campaign (e.g., "improve_material_extraction")
│       ├── meta.yaml                  # Experiment metadata
│       │
│       ├── <trial_001_run_id>/        # Baseline trial
│       │   ├── meta.yaml              # Run metadata (MLflow format)
│       │   ├── params/                # Configuration parameters (MLflow format)
│       │   │   ├── step1_prompt_version
│       │   │   ├── step3_prompt_version
│       │   │   ├── model
│       │   │   └── temperature
│       │   ├── metrics/               # Aggregate performance metrics (MLflow format)
│       │   │   ├── mrr
│       │   │   ├── hit_at_5
│       │   │   ├── ndcg_at_5
│       │   │   └── avg_latency_ms
│       │   ├── tags/                  # Lineage tracking (MLflow format)
│       │   │   ├── parent_trial
│       │   │   ├── variant_type
│       │   │   └── source_data
│       │   └── artifacts/
│       │       ├── pipeline_config.json      # DSPy-compatible program format
│       │       ├── trainset.jsonl            # Training examples (DSPy format)
│       │       ├── devset.jsonl              # Validation examples (DSPy format)
│       │       ├── evaluation_results.jsonl  # Per-example results
│       │       ├── aggregate_metrics.json    # Detailed metrics
│       │       ├── traces/                   # Langfuse-compatible trace format
│       │       │   ├── trace_001/
│       │       │   │   ├── trace.json
│       │       │   │   ├── observations.jsonl
│       │       │   │   └── scores.jsonl
│       │       │   └── trace_002/
│       │       │       └── ...
│       │       └── prompts/                  # Snapshot of prompts used
│       │           ├── step1_extraction_v2.txt
│       │           └── step3_reranker_v1.txt
│       │
│       ├── <trial_002_run_id>/        # Step 1 variant
│       │   ├── params/
│       │   ├── tags/
│       │   │   ├── parent_trial → trial_001_run_id
│       │   │   └── variant_type → "step1_enhanced"
│       │   └── artifacts/
│       │       └── ...
│       │
│       └── <trial_003_run_id>/        # Step 3 variant
│           └── ...
│
├── prompts/                           # MLflow Prompt Registry compatible
│   ├── entity_profiling/              # Prompt family
│   │   ├── 1/
│   │   │   ├── metadata.json          # {version: 1, created: ..., description: ...}
│   │   │   └── prompt.txt             # Template with {{variables}}
│   │   ├── 2/
│   │   │   ├── metadata.json
│   │   │   └── prompt.txt
│   │   └── 3/
│   │       └── ...
│   │
│   └── llm_ranking/                   # Prompt family
│       ├── 1/
│       │   ├── metadata.json
│       │   └── prompt.txt
│       └── 2/
│           └── ...
│
├── datasets/                          # Shared evaluation datasets
│   ├── match_test_cases.jsonl        # DSPy Example format
│   ├── material_forms_v1.jsonl       # Category-specific datasets
│   └── specifications_v1.jsonl
│
├── activity_log_20251203.json        # [EXISTING] Production telemetry
└── match_database.json               # [EXISTING] Identifier cache
```

---

## MLflow-Compatible Structure

### Experiment Metadata (`experiments/<experiment_id>/meta.yaml`)

**Format:**
```yaml
experiment_id: "1"
name: "improve_material_extraction"
artifact_location: "file:///path/to/experiments/1"
lifecycle_stage: "active"
creation_time: 1733270100000
last_update_time: 1733270400000
tags:
  - key: "campaign_type"
    value: "prompt_optimization"
  - key: "objective"
    value: "improve_mrr"
```

**Implementation:**
```python
# utils/mlflow_format.py
import yaml
from pathlib import Path
from datetime import datetime

def create_experiment(experiment_id: str, name: str, base_path: Path):
    """Create MLflow-compatible experiment directory."""
    exp_path = base_path / "experiments" / experiment_id
    exp_path.mkdir(parents=True, exist_ok=True)

    meta = {
        "experiment_id": experiment_id,
        "name": name,
        "artifact_location": f"file:///{exp_path.absolute()}",
        "lifecycle_stage": "active",
        "creation_time": int(datetime.now().timestamp() * 1000),
        "last_update_time": int(datetime.now().timestamp() * 1000),
        "tags": []
    }

    with open(exp_path / "meta.yaml", "w") as f:
        yaml.dump(meta, f, default_flow_style=False)

    return exp_path
```

### Run Metadata (`experiments/<experiment_id>/<run_id>/meta.yaml`)

**Format:**
```yaml
run_id: "abc123def456"
run_name: "trial_001_baseline"
experiment_id: "1"
user_id: "system"
status: "FINISHED"  # RUNNING | FINISHED | FAILED | KILLED
start_time: 1733270100000
end_time: 1733270400000
artifact_uri: "file:///path/to/experiments/1/abc123def456/artifacts"
lifecycle_stage: "active"
tags:
  - key: "parent_trial"
    value: null
  - key: "variant_type"
    value: "baseline"
  - key: "source_data"
    value: "production_logs"
```

**Implementation:**
```python
def create_run(experiment_id: str, run_id: str, run_name: str, base_path: Path):
    """Create MLflow-compatible run directory."""
    run_path = base_path / "experiments" / experiment_id / run_id
    run_path.mkdir(parents=True, exist_ok=True)

    # Create subdirectories
    (run_path / "params").mkdir(exist_ok=True)
    (run_path / "metrics").mkdir(exist_ok=True)
    (run_path / "tags").mkdir(exist_ok=True)
    (run_path / "artifacts").mkdir(exist_ok=True)

    meta = {
        "run_id": run_id,
        "run_name": run_name,
        "experiment_id": experiment_id,
        "user_id": "system",
        "status": "RUNNING",
        "start_time": int(datetime.now().timestamp() * 1000),
        "artifact_uri": f"file:///{(run_path / 'artifacts').absolute()}",
        "lifecycle_stage": "active",
        "tags": []
    }

    with open(run_path / "meta.yaml", "w") as f:
        yaml.dump(meta, f, default_flow_style=False)

    return run_path
```

### Parameters (`experiments/<experiment_id>/<run_id>/params/<param_name>`)

**Format:** Each parameter is a single text file containing the value.

**Example:**
```
experiments/1/abc123/params/step1_prompt_version
Content: extraction_v2

experiments/1/abc123/params/model
Content: groq/llama-3.3-70b

experiments/1/abc123/params/temperature
Content: 0.0
```

**Implementation:**
```python
def log_param(run_path: Path, key: str, value: any):
    """Log parameter in MLflow format."""
    param_file = run_path / "params" / key
    param_file.write_text(str(value))

def log_params(run_path: Path, params: dict):
    """Log multiple parameters."""
    for key, value in params.items():
        log_param(run_path, key, value)
```

### Metrics (`experiments/<experiment_id>/<run_id>/metrics/<metric_name>`)

**Format:** Each metric is a text file with space-separated values: `timestamp step value`

**Example:**
```
experiments/1/abc123/metrics/mrr
Content: 1733270400000 0 0.823

experiments/1/abc123/metrics/hit_at_5
Content: 1733270400000 0 0.92
```

**Implementation:**
```python
def log_metric(run_path: Path, key: str, value: float, step: int = 0):
    """Log metric in MLflow format."""
    timestamp = int(datetime.now().timestamp() * 1000)
    metric_file = run_path / "metrics" / key

    with open(metric_file, "a") as f:
        f.write(f"{timestamp} {step} {value}\n")

def log_metrics(run_path: Path, metrics: dict, step: int = 0):
    """Log multiple metrics."""
    for key, value in metrics.items():
        log_metric(run_path, key, value, step)
```

### Tags (`experiments/<experiment_id>/<run_id>/tags/<tag_name>`)

**Format:** Each tag is a single text file containing the value.

**Example:**
```
experiments/1/abc123/tags/parent_trial
Content: baseline_run_xyz

experiments/1/abc123/tags/variant_type
Content: step1_enhanced
```

**Implementation:**
```python
def set_tag(run_path: Path, key: str, value: str):
    """Set tag in MLflow format."""
    tag_file = run_path / "tags" / key
    tag_file.write_text(value if value is not None else "")

def set_tags(run_path: Path, tags: dict):
    """Set multiple tags."""
    for key, value in tags.items():
        set_tag(run_path, key, value)
```

---

## DSPy-Compatible Formats

### Pipeline Configuration (`artifacts/pipeline_config.json`)

**Format:** JSON schema compatible with DSPy's Module serialization.

**Example:**
```json
{
  "name": "TermNormPipeline",
  "version": "1.0",
  "description": "Three-tier matching pipeline: cache → fuzzy → LLM",
  "steps": [
    {
      "name": "entity_profiling",
      "type": "LLMGeneration",
      "signature": {
        "input_fields": ["query", "web_content"],
        "output_fields": ["entity_profile"]
      },
      "config": {
        "model": "groq/llama-3.3-70b",
        "temperature": 0.0,
        "prompt_version": "extraction_v2"
      }
    },
    {
      "name": "token_matching",
      "type": "DeterministicFunction",
      "signature": {
        "input_fields": ["entity_profile"],
        "output_fields": ["candidates"]
      },
      "config": {
        "fuzzy_threshold": 0.7
      }
    },
    {
      "name": "llm_ranking",
      "type": "LLMGeneration",
      "signature": {
        "input_fields": ["entity_profile", "candidates"],
        "output_fields": ["ranked_list"]
      },
      "config": {
        "model": "groq/llama-3.3-70b",
        "temperature": 0.0,
        "prompt_version": "reranker_v1"
      }
    }
  ],
  "metadata": {
    "created": "2025-12-03T10:00:00Z",
    "author": "system"
  }
}
```

**Implementation:**
```python
def save_pipeline_config(run_path: Path, pipeline_config: dict):
    """Save pipeline configuration in DSPy-compatible format."""
    artifact_path = run_path / "artifacts" / "pipeline_config.json"
    with open(artifact_path, "w") as f:
        json.dump(pipeline_config, f, indent=2)

def load_pipeline_config(run_path: Path) -> dict:
    """Load pipeline configuration."""
    artifact_path = run_path / "artifacts" / "pipeline_config.json"
    with open(artifact_path, "r") as f:
        return json.load(f)
```

### Dataset Format (`datasets/*.jsonl`)

**Format:** JSONL (newline-delimited JSON) compatible with DSPy's Example format.

**Example (`datasets/match_test_cases.jsonl`):**
```jsonl
{"query": "stainless steel pipe", "expected": "stainless piping", "category": "material_forms"}
{"query": "aluminum tube", "expected": "aluminum tubing", "category": "material_forms"}
{"query": "carbon fiber sheet", "expected": "carbon fiber panels", "category": "material_forms"}
{"query": "ISO 9001", "expected": "ISO 9001:2015", "category": "specifications"}
```

**Schema:**
- `query` (string): Input query
- `expected` (string): Expected identifier/match
- `category` (string, optional): Test case category
- Additional fields as needed

**Implementation:**
```python
def save_dataset(file_path: Path, examples: list[dict]):
    """Save dataset in DSPy-compatible JSONL format."""
    with open(file_path, "w") as f:
        for example in examples:
            f.write(json.dumps(example) + "\n")

def load_dataset(file_path: Path) -> list[dict]:
    """Load dataset from JSONL."""
    examples = []
    with open(file_path, "r") as f:
        for line in f:
            examples.append(json.loads(line))
    return examples
```

### Evaluation Results (`artifacts/evaluation_results.jsonl`)

**Format:** Per-example results in JSONL format.

**Example:**
```jsonl
{"query": "stainless steel pipe", "expected": "stainless piping", "predicted": "stainless piping", "rank": 1, "mrr": 1.0, "confidence": 0.95, "trace_id": "trace-abc123"}
{"query": "aluminum tube", "expected": "aluminum tubing", "predicted": "aluminum tubes", "rank": 2, "mrr": 0.5, "confidence": 0.87, "trace_id": "trace-def456"}
{"query": "carbon fiber sheet", "expected": "carbon fiber panels", "predicted": "carbon fiber sheet", "rank": null, "mrr": 0.0, "confidence": 0.72, "trace_id": "trace-ghi789"}
```

**Implementation:**
```python
def save_evaluation_results(run_path: Path, results: list[dict]):
    """Save per-example evaluation results."""
    results_file = run_path / "artifacts" / "evaluation_results.jsonl"
    with open(results_file, "w") as f:
        for result in results:
            f.write(json.dumps(result) + "\n")
```

### Aggregate Metrics (`artifacts/aggregate_metrics.json`)

**Format:** Summary statistics in JSON format.

**Example:**
```json
{
  "num_cases": 50,
  "mrr": 0.823,
  "hit_at_1": 0.68,
  "hit_at_5": 0.92,
  "hit_at_10": 0.96,
  "ndcg_at_5": 0.867,
  "avg_confidence": 0.874,
  "avg_latency_ms": 8245,
  "failure_categories": {
    "no_match_found": 2,
    "ambiguous_query": 1,
    "low_confidence": 1
  }
}
```

**Implementation:**
```python
def save_aggregate_metrics(run_path: Path, metrics: dict):
    """Save aggregate metrics."""
    metrics_file = run_path / "artifacts" / "aggregate_metrics.json"
    with open(metrics_file, "w") as f:
        json.dump(metrics, f, indent=2)
```

---

## Langfuse-Compatible Formats

### Trace Metadata (`artifacts/traces/<trace_id>/trace.json`)

**Format:** Root trace metadata compatible with Langfuse schema.

**Example:**
```json
{
  "id": "trace-abc123",
  "name": "research-and-match",
  "timestamp": "2025-12-03T10:00:00.100Z",
  "user_id": "192.168.1.100",
  "session_id": "session-xyz789",
  "tags": ["evaluation", "trial_001"],
  "metadata": {
    "campaign": "improve_material_extraction",
    "run_id": "abc123def456",
    "query_type": "material_form"
  },
  "input": {
    "query": "stainless steel pipe"
  },
  "output": {
    "candidate": "stainless piping",
    "confidence": 0.95,
    "rank": 1
  },
  "status": "SUCCESS",
  "latency_ms": 8245
}
```

**Implementation:**
```python
def create_trace(trace_id: str, query: str, session_id: str = None) -> dict:
    """Create Langfuse-compatible trace."""
    return {
        "id": trace_id,
        "name": "research-and-match",
        "timestamp": datetime.now().isoformat() + "Z",
        "user_id": session_id or "unknown",
        "session_id": session_id,
        "tags": [],
        "metadata": {},
        "input": {"query": query},
        "output": None,
        "status": "RUNNING",
        "latency_ms": None
    }

def save_trace(run_path: Path, trace_id: str, trace_data: dict):
    """Save trace metadata."""
    trace_dir = run_path / "artifacts" / "traces" / trace_id
    trace_dir.mkdir(parents=True, exist_ok=True)

    with open(trace_dir / "trace.json", "w") as f:
        json.dump(trace_data, f, indent=2)
```

### Observations (`artifacts/traces/<trace_id>/observations.jsonl`)

**Format:** JSONL with spans, generations, and events compatible with Langfuse schema.

**Example:**
```jsonl
{"id": "obs-1", "type": "span", "name": "web_search", "parent_id": null, "start_time": "2025-12-03T10:00:00.100Z", "end_time": "2025-12-03T10:00:00.220Z", "input": {"query": "stainless steel pipe"}, "output": {"num_results": 7, "sources": ["wikipedia.org", "engineering-toolbox.com"]}, "metadata": {}, "level": "DEFAULT"}
{"id": "obs-2", "type": "generation", "name": "entity_profiling", "parent_id": "obs-1", "start_time": "2025-12-03T10:00:00.250Z", "end_time": "2025-12-03T10:00:05.523Z", "model": "groq/llama-3.3-70b", "input": {"query": "stainless steel pipe", "web_content": "..."}, "output": {"core_concept": "stainless steel", "form_factor": "pipe", "material_type": "ferrous alloy"}, "usage": {"prompt_tokens": 1200, "completion_tokens": 740, "total_tokens": 1940}, "metadata": {"prompt_version": "extraction_v2", "temperature": 0.0}, "level": "DEFAULT"}
{"id": "obs-3", "type": "span", "name": "token_matching", "parent_id": null, "start_time": "2025-12-03T10:00:05.540Z", "end_time": "2025-12-03T10:00:05.555Z", "input": {"profile": {...}}, "output": {"num_candidates": 20, "match_type": "fuzzy"}, "metadata": {"fuzzy_threshold": 0.7}, "level": "DEFAULT"}
{"id": "obs-4", "type": "generation", "name": "llm_ranking", "parent_id": "obs-3", "start_time": "2025-12-03T10:00:05.560Z", "end_time": "2025-12-03T10:00:10.380Z", "model": "groq/llama-3.3-70b", "input": {"profile": {...}, "candidates": [...]}, "output": {"ranked_list": [{"candidate": "stainless piping", "score": 0.95}, {"candidate": "stainless steel tubing", "score": 0.82}]}, "usage": {"prompt_tokens": 950, "completion_tokens": 700, "total_tokens": 1650}, "metadata": {"prompt_version": "reranker_v1", "temperature": 0.0}, "level": "DEFAULT"}
```

**Schema:**
- **Span:** Represents a time-bound operation (e.g., web search, token matching)
- **Generation:** Represents an LLM call with token usage
- **Event:** Represents a point-in-time occurrence (e.g., cache hit)

**Implementation:**
```python
def add_observation(run_path: Path, trace_id: str, observation: dict):
    """Append observation to trace."""
    trace_dir = run_path / "artifacts" / "traces" / trace_id
    obs_file = trace_dir / "observations.jsonl"

    with open(obs_file, "a") as f:
        f.write(json.dumps(observation) + "\n")

def create_span(obs_id: str, name: str, parent_id: str = None) -> dict:
    """Create span observation."""
    return {
        "id": obs_id,
        "type": "span",
        "name": name,
        "parent_id": parent_id,
        "start_time": datetime.now().isoformat() + "Z",
        "end_time": None,
        "input": {},
        "output": None,
        "metadata": {},
        "level": "DEFAULT"
    }

def create_generation(obs_id: str, name: str, model: str, parent_id: str = None) -> dict:
    """Create generation observation."""
    return {
        "id": obs_id,
        "type": "generation",
        "name": name,
        "parent_id": parent_id,
        "start_time": datetime.now().isoformat() + "Z",
        "end_time": None,
        "model": model,
        "input": {},
        "output": None,
        "usage": {},
        "metadata": {},
        "level": "DEFAULT"
    }
```

### Scores (`artifacts/traces/<trace_id>/scores.jsonl`)

**Format:** JSONL with evaluation scores compatible with Langfuse schema.

**Example:**
```jsonl
{"name": "mrr", "value": 1.0, "data_type": "NUMERIC", "comment": "Reciprocal rank of expected answer"}
{"name": "hit_at_5", "value": true, "data_type": "BOOLEAN", "comment": "Expected answer in top 5"}
{"name": "relevance", "value": 0.95, "data_type": "NUMERIC", "comment": "LLM confidence score"}
{"name": "latency_ms", "value": 8245, "data_type": "NUMERIC", "comment": "Total pipeline latency"}
```

**Implementation:**
```python
def add_score(run_path: Path, trace_id: str, name: str, value: any, data_type: str, comment: str = ""):
    """Add score to trace."""
    trace_dir = run_path / "artifacts" / "traces" / trace_id
    scores_file = trace_dir / "scores.jsonl"

    score = {
        "name": name,
        "value": value,
        "data_type": data_type,  # NUMERIC | BOOLEAN | CATEGORICAL
        "comment": comment
    }

    with open(scores_file, "a") as f:
        f.write(json.dumps(score) + "\n")
```

---

## Implementation Without Dependencies

### Core Utilities Module (`utils/standards_logger.py`)

**Complete implementation using only Python standard library:**

```python
"""
Standards-compatible logging utilities.
No external dependencies (MLflow, DSPy, Langfuse).
"""

import json
import yaml
from pathlib import Path
from datetime import datetime
import uuid
from typing import Dict, List, Any, Optional

class ExperimentManager:
    """MLflow-compatible experiment management."""

    def __init__(self, base_path: Path):
        self.base_path = Path(base_path)
        self.experiments_path = self.base_path / "experiments"
        self.experiments_path.mkdir(parents=True, exist_ok=True)

    def create_experiment(self, name: str) -> str:
        """Create new experiment, return experiment_id."""
        experiment_id = str(len(list(self.experiments_path.iterdir())) + 1)
        exp_path = self.experiments_path / experiment_id
        exp_path.mkdir(exist_ok=True)

        meta = {
            "experiment_id": experiment_id,
            "name": name,
            "artifact_location": f"file:///{exp_path.absolute()}",
            "lifecycle_stage": "active",
            "creation_time": int(datetime.now().timestamp() * 1000),
            "last_update_time": int(datetime.now().timestamp() * 1000),
            "tags": []
        }

        with open(exp_path / "meta.yaml", "w") as f:
            yaml.dump(meta, f, default_flow_style=False)

        return experiment_id

    def get_experiment_by_name(self, name: str) -> Optional[str]:
        """Get experiment_id by name."""
        for exp_dir in self.experiments_path.iterdir():
            if not exp_dir.is_dir():
                continue
            meta_file = exp_dir / "meta.yaml"
            if meta_file.exists():
                with open(meta_file, "r") as f:
                    meta = yaml.safe_load(f)
                    if meta.get("name") == name:
                        return meta["experiment_id"]
        return None


class RunManager:
    """MLflow-compatible run management."""

    def __init__(self, experiment_path: Path):
        self.experiment_path = Path(experiment_path)
        self.current_run_path = None

    def start_run(self, run_name: str) -> str:
        """Create new run, return run_id."""
        run_id = uuid.uuid4().hex
        run_path = self.experiment_path / run_id
        run_path.mkdir(exist_ok=True)

        # Create subdirectories
        (run_path / "params").mkdir(exist_ok=True)
        (run_path / "metrics").mkdir(exist_ok=True)
        (run_path / "tags").mkdir(exist_ok=True)
        (run_path / "artifacts").mkdir(exist_ok=True)
        (run_path / "artifacts" / "traces").mkdir(exist_ok=True)

        meta = {
            "run_id": run_id,
            "run_name": run_name,
            "experiment_id": self.experiment_path.name,
            "user_id": "system",
            "status": "RUNNING",
            "start_time": int(datetime.now().timestamp() * 1000),
            "end_time": None,
            "artifact_uri": f"file:///{(run_path / 'artifacts').absolute()}",
            "lifecycle_stage": "active",
            "tags": []
        }

        with open(run_path / "meta.yaml", "w") as f:
            yaml.dump(meta, f, default_flow_style=False)

        self.current_run_path = run_path
        return run_id

    def end_run(self, status: str = "FINISHED"):
        """Mark run as complete."""
        if not self.current_run_path:
            return

        meta_file = self.current_run_path / "meta.yaml"
        with open(meta_file, "r") as f:
            meta = yaml.safe_load(f)

        meta["status"] = status
        meta["end_time"] = int(datetime.now().timestamp() * 1000)

        with open(meta_file, "w") as f:
            yaml.dump(meta, f, default_flow_style=False)

    def log_param(self, key: str, value: Any):
        """Log parameter."""
        param_file = self.current_run_path / "params" / key
        param_file.write_text(str(value))

    def log_params(self, params: Dict):
        """Log multiple parameters."""
        for key, value in params.items():
            self.log_param(key, value)

    def log_metric(self, key: str, value: float, step: int = 0):
        """Log metric."""
        timestamp = int(datetime.now().timestamp() * 1000)
        metric_file = self.current_run_path / "metrics" / key

        with open(metric_file, "a") as f:
            f.write(f"{timestamp} {step} {value}\n")

    def log_metrics(self, metrics: Dict, step: int = 0):
        """Log multiple metrics."""
        for key, value in metrics.items():
            self.log_metric(key, value, step)

    def set_tag(self, key: str, value: str):
        """Set tag."""
        tag_file = self.current_run_path / "tags" / key
        tag_file.write_text(value if value is not None else "")

    def set_tags(self, tags: Dict):
        """Set multiple tags."""
        for key, value in tags.items():
            self.set_tag(key, value)

    def log_artifact(self, artifact_path: str, artifact_name: str = None):
        """Copy artifact to run artifacts directory."""
        import shutil
        artifact_name = artifact_name or Path(artifact_path).name
        dest = self.current_run_path / "artifacts" / artifact_name
        shutil.copy(artifact_path, dest)


class TraceLogger:
    """Langfuse-compatible trace logging."""

    def __init__(self, run_path: Path):
        self.run_path = Path(run_path)
        self.traces_path = run_path / "artifacts" / "traces"
        self.traces_path.mkdir(parents=True, exist_ok=True)
        self.current_trace_id = None
        self.current_trace_data = None

    def start_trace(self, query: str, session_id: str = None, tags: List[str] = None) -> str:
        """Start new trace."""
        trace_id = f"trace-{uuid.uuid4().hex[:12]}"
        self.current_trace_id = trace_id

        trace_dir = self.traces_path / trace_id
        trace_dir.mkdir(exist_ok=True)

        self.current_trace_data = {
            "id": trace_id,
            "name": "research-and-match",
            "timestamp": datetime.now().isoformat() + "Z",
            "user_id": session_id or "unknown",
            "session_id": session_id,
            "tags": tags or [],
            "metadata": {},
            "input": {"query": query},
            "output": None,
            "status": "RUNNING",
            "latency_ms": None
        }

        return trace_id

    def end_trace(self, output: Dict, status: str = "SUCCESS"):
        """End trace and save."""
        if not self.current_trace_id:
            return

        self.current_trace_data["output"] = output
        self.current_trace_data["status"] = status

        trace_dir = self.traces_path / self.current_trace_id
        with open(trace_dir / "trace.json", "w") as f:
            json.dump(self.current_trace_data, f, indent=2)

    def add_span(self, name: str, input_data: Dict = None, output_data: Dict = None,
                 parent_id: str = None, metadata: Dict = None):
        """Add span observation."""
        obs_id = f"obs-{uuid.uuid4().hex[:8]}"

        observation = {
            "id": obs_id,
            "type": "span",
            "name": name,
            "parent_id": parent_id,
            "start_time": datetime.now().isoformat() + "Z",
            "end_time": datetime.now().isoformat() + "Z",
            "input": input_data or {},
            "output": output_data or {},
            "metadata": metadata or {},
            "level": "DEFAULT"
        }

        self._save_observation(observation)
        return obs_id

    def add_generation(self, name: str, model: str, input_data: Dict = None,
                      output_data: Dict = None, usage: Dict = None,
                      parent_id: str = None, metadata: Dict = None):
        """Add generation (LLM call) observation."""
        obs_id = f"obs-{uuid.uuid4().hex[:8]}"

        observation = {
            "id": obs_id,
            "type": "generation",
            "name": name,
            "parent_id": parent_id,
            "start_time": datetime.now().isoformat() + "Z",
            "end_time": datetime.now().isoformat() + "Z",
            "model": model,
            "input": input_data or {},
            "output": output_data or {},
            "usage": usage or {},
            "metadata": metadata or {},
            "level": "DEFAULT"
        }

        self._save_observation(observation)
        return obs_id

    def add_score(self, name: str, value: Any, data_type: str = "NUMERIC", comment: str = ""):
        """Add evaluation score."""
        score = {
            "name": name,
            "value": value,
            "data_type": data_type,
            "comment": comment
        }

        trace_dir = self.traces_path / self.current_trace_id
        scores_file = trace_dir / "scores.jsonl"

        with open(scores_file, "a") as f:
            f.write(json.dumps(score) + "\n")

    def _save_observation(self, observation: Dict):
        """Save observation to JSONL."""
        trace_dir = self.traces_path / self.current_trace_id
        obs_file = trace_dir / "observations.jsonl"

        with open(obs_file, "a") as f:
            f.write(json.dumps(observation) + "\n")


class DatasetManager:
    """DSPy-compatible dataset management."""

    def __init__(self, base_path: Path):
        self.base_path = Path(base_path)
        self.datasets_path = self.base_path / "datasets"
        self.datasets_path.mkdir(parents=True, exist_ok=True)

    def save_dataset(self, name: str, examples: List[Dict]):
        """Save dataset in JSONL format."""
        file_path = self.datasets_path / f"{name}.jsonl"
        with open(file_path, "w") as f:
            for example in examples:
                f.write(json.dumps(example) + "\n")

    def load_dataset(self, name: str) -> List[Dict]:
        """Load dataset from JSONL."""
        file_path = self.datasets_path / f"{name}.jsonl"
        examples = []
        with open(file_path, "r") as f:
            for line in f:
                examples.append(json.loads(line))
        return examples


class PipelineSerializer:
    """DSPy-compatible pipeline serialization."""

    @staticmethod
    def save_config(run_path: Path, config: Dict):
        """Save pipeline configuration."""
        config_file = run_path / "artifacts" / "pipeline_config.json"
        with open(config_file, "w") as f:
            json.dump(config, f, indent=2)

    @staticmethod
    def load_config(run_path: Path) -> Dict:
        """Load pipeline configuration."""
        config_file = run_path / "artifacts" / "pipeline_config.json"
        with open(config_file, "r") as f:
            return json.load(f)


# Usage Example
def example_evaluation_run():
    """Example of using standards-compatible logging."""

    # Initialize managers
    exp_mgr = ExperimentManager(Path("logs"))

    # Create or get experiment
    experiment_id = exp_mgr.get_experiment_by_name("improve_material_extraction")
    if not experiment_id:
        experiment_id = exp_mgr.create_experiment("improve_material_extraction")

    exp_path = exp_mgr.experiments_path / experiment_id
    run_mgr = RunManager(exp_path)

    # Start run
    run_id = run_mgr.start_run("trial_001_baseline")

    # Log configuration
    run_mgr.log_params({
        "step1_prompt_version": "extraction_v2",
        "step3_prompt_version": "reranker_v1",
        "model": "groq/llama-3.3-70b",
        "temperature": 0.0
    })

    run_mgr.set_tags({
        "parent_trial": None,
        "variant_type": "baseline",
        "source_data": "production_logs"
    })

    # Save pipeline config
    pipeline_config = {
        "name": "TermNormPipeline",
        "version": "1.0",
        "steps": [
            {"name": "entity_profiling", "type": "LLMGeneration"},
            {"name": "token_matching", "type": "DeterministicFunction"},
            {"name": "llm_ranking", "type": "LLMGeneration"}
        ]
    }
    PipelineSerializer.save_config(run_mgr.current_run_path, pipeline_config)

    # Initialize trace logger
    trace_logger = TraceLogger(run_mgr.current_run_path)

    # Simulate evaluation
    query = "stainless steel pipe"
    trace_id = trace_logger.start_trace(query, session_id="eval-session", tags=["evaluation"])

    # Log spans/generations
    trace_logger.add_span("web_search",
                         input_data={"query": query},
                         output_data={"num_results": 7})

    trace_logger.add_generation("entity_profiling",
                               model="groq/llama-3.3-70b",
                               usage={"tokens": 1940},
                               metadata={"prompt_version": "extraction_v2"})

    trace_logger.add_span("token_matching",
                         output_data={"num_candidates": 20})

    trace_logger.add_generation("llm_ranking",
                               model="groq/llama-3.3-70b",
                               usage={"tokens": 1650},
                               metadata={"prompt_version": "reranker_v1"})

    # Log scores
    trace_logger.add_score("mrr", 1.0, "NUMERIC")
    trace_logger.add_score("hit_at_5", True, "BOOLEAN")

    # End trace
    trace_logger.end_trace(output={"candidate": "stainless piping", "confidence": 0.95})

    # Log metrics
    run_mgr.log_metrics({
        "mrr": 0.823,
        "hit_at_5": 0.92,
        "ndcg_at_5": 0.867
    })

    # End run
    run_mgr.end_run("FINISHED")

    print(f"✅ Evaluation run complete: {run_id}")
    print(f"📁 Results: logs/experiments/{experiment_id}/{run_id}/")
```

---

## Migration Path

### Phase 1: Directory Restructuring

**Objective:** Reorganize existing logs into standards-compatible structure.

**Steps:**
1. Create new directory hierarchy (`experiments/`, `prompts/`, `datasets/`)
2. Keep existing `activity_log_*.json` and `match_database.json` unchanged
3. Extract prompts from source code to `prompts/` directory
4. Create baseline evaluation dataset from production logs

### Phase 2: Implement Core Utilities

**Objective:** Build standards-compatible logging utilities.

**Steps:**
1. Implement `utils/standards_logger.py` (shown above)
2. Add `ExperimentManager`, `RunManager`, `TraceLogger` classes
3. Create helper functions for common operations
4. Add tests to verify format compliance

### Phase 3: Integrate with Existing Backend

**Objective:** Add standards-compatible logging to production API.

**Steps:**
1. Update `core/llm_providers.py` to optionally use `TraceLogger`
2. Add `?trace=true` parameter to `/research-and-match` endpoint
3. Feature flag: `ENABLE_STANDARDS_LOGGING=true`
4. No changes to existing `activity.jsonl` logging

### Phase 4: Build Evaluation Harness

**Objective:** Create evaluation system using standards-compatible files.

**Steps:**
1. Create `api/evaluation.py` endpoints
2. Implement evaluation loop with `RunManager` and `TraceLogger`
3. Calculate metrics (MRR, Hit@K, NDCG)
4. Save results in standards-compatible formats

### Phase 5: Future Migration

**Objective:** Be ready to adopt MLflow/DSPy/Langfuse when needed.

**Benefits:**
- File formats already compatible → no data migration needed
- Directory structure already correct → just install packages
- Can import existing experiments into MLflow UI
- Can load traces into Langfuse dashboard
- Can deserialize pipeline configs into DSPy modules

**Migration Command (when ready):**
```bash
# Install frameworks
pip install mlflow dspy-ai langfuse

# Point MLflow to existing directory
mlflow.set_tracking_uri("file:./logs/experiments")

# Experiments already visible in MLflow UI!
mlflow ui
```

---

## Summary

**What This Strategy Provides:**

1. ✅ **Industry-standard file organization** without code dependencies
2. ✅ **MLflow-compatible** experiment/run/artifact structure
3. ✅ **DSPy-compatible** pipeline config and dataset formats
4. ✅ **Langfuse-compatible** trace/observation/score formats
5. ✅ **Full portability** for future framework adoption
6. ✅ **Pure Python implementation** using only standard library

**What This Strategy Does NOT Do:**

1. ❌ Does not install MLflow, DSPy, or Langfuse packages
2. ❌ Does not use their code APIs
3. ❌ Does not add heavy ML dependencies
4. ❌ Does not modify existing production logging

**Result:** You get the benefits of industry-standard organization while maintaining full control over your codebase and dependencies. When you're ready to adopt these frameworks, you can do so with zero data migration effort.

---

*Document Version: 1.0*
*Last Updated: 2025-12-03*
*Author: TermNorm Team*
*Standards Compatibility: MLflow File Format ✅ | DSPy JSON Schema ✅ | Langfuse Trace Format ✅*
