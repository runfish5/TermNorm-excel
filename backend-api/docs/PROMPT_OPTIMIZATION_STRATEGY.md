# Prompt Optimization Strategy for TermNorm Backend

## Executive Summary

This document establishes the **non-negotiable architectural standards** for integrating the TermNorm FastAPI backend with prompt optimization and evaluation frameworks. The strategy prioritizes industry-standard tools—**MLflow**, **DSPy**, and **LangFuse**—as the foundation, with **GitHub Models** positioned as an optional complementary tool.

**Key Principles:**
1. **MLflow** is the backbone for experiment tracking, prompt registry, and artifact storage
2. **DSPy** format is required for all optimized program serialization
3. **LangFuse** format is mandatory for execution traces and observability
4. **GitHub Models** can be used strategically for prompt storage and evaluation execution
5. **Full ecosystem portability** is non-negotiable

---

## Table of Contents

1. [CRITICAL CONSTRAINTS (Non-Negotiable)](#critical-constraints-non-negotiable)
2. [STRATEGIC GITHUB MODELS INTEGRATION](#strategic-github-models-integration)
3. [UNIFIED HIERARCHY (Final Structure)](#unified-hierarchy-final-structure)
4. [IMPLEMENTATION WORKFLOW](#implementation-workflow)
5. [KEY TAKEAWAYS](#key-takeaways)
6. [Current State Analysis](#current-state-analysis)
7. [Target Architecture](#target-architecture)
8. [Implementation Phases](#implementation-phases)
9. [Data Format Specifications](#data-format-specifications)
10. [Integration Points](#integration-points)
11. [Migration Path](#migration-path)
12. [Security & Performance Considerations](#security--performance-considerations)
13. [Success Metrics](#success-metrics)
14. [References](#references)
15. [Appendix: Example Code Snippets](#appendix-example-code-snippets)

---

## CRITICAL CONSTRAINTS (Non-Negotiable)

> **⚠️ IMPORTANT:** The following standards are **MANDATORY** and **NON-NEGOTIABLE** for this project.
> Any implementation must fully comply with MLflow, DSPy, and LangFuse specifications.
> GitHub Models is a **complementary tool** that can be used strategically where compatible.

### 1. MLflow-Compatible Structure

**MLflow organizes evaluations around experiments/runs with params, metrics, and artifacts.**

**Required Directory Structure:**
```
backend-api/logs/
├── mlruns/                                    # Standard MLflow tracking
│   └── <experiment_id>/
│       └── <run_id>/
│           ├── params/                        # Hyperparameters
│           ├── metrics/                       # Scalar metrics
│           ├── tags/                          # Metadata tags (parent_trial, variant_type)
│           └── artifacts/
│               ├── traces/                    # LLM call traces (LangFuse format)
│               ├── prompt.yml                 # Can be GitHub Models format!
│               └── dspy_program.json          # DSPy compiled output
│
├── prompts/                                   # MLflow Prompt Registry format
│   └── <prompt_name>/
│       └── <version>/
│           ├── metadata.json                  # Version info, commit message
│           └── prompt.{json,yml}              # Template (text or chat format)
│
└── datasets/                                  # Shared evaluation datasets
    └── match_test_cases.jsonl                 # DSPy/LangFuse format
```

**🚨 Key Rules:**
- ✅ Each evaluation run **MUST** use `mlflow.evaluate()` or `mlflow.genai.evaluate()` API
- ✅ Prompts **MUST** support `{{variable}}` format (double braces for template variables)
- ✅ Traces **MUST** include latency, token usage, and quality metrics
- ✅ Campaign = MLflow Experiment
- ✅ Trial = MLflow Run
- ✅ Lineage tracking **MUST** use MLflow tags (`parent_trial`, `variant_type`, `source_data`)

**Integration with TermNorm:**
- Current `logs/activity.jsonl` remains for production telemetry
- New `logs/mlruns/` directory created for optimization campaigns
- Existing `core/llm_providers.py` extended with MLflow logging hooks
- Prompts extracted from `research_and_rank/*.py` to `prompts/` registry

---

### 2. DSPy-Compatible Optimization Tracking

**DSPy optimizers (MIPROv2, BootstrapFewShot) perform multi-stage optimization with compiled programs.**

**Required Directory Structure:**
```
logs/mlruns/<experiment_id>/<run_id>/artifacts/
├── dspy_program.json                          # REQUIRED: DSPy compiled program
├── trainset.jsonl                             # Training examples (DSPy format)
├── devset.jsonl                               # Dev/validation examples
├── metric.py                                  # Metric function definition
├── evaluation_results.jsonl                   # Per-example scores
└── aggregate_metrics.json                     # Overall performance
```

**🚨 Key Rules:**
- ✅ Optimized programs **MUST** be saved in DSPy's plain-text JSON format
- ✅ Metrics **MUST** accept `(example, pred, trace=None)` signature
- ✅ Programs **MUST** support `.save()` and `.load()` methods
- ✅ All parameters and steps **MUST** be serializable to JSON
- ✅ Training examples **MUST** use DSPy's `Example` format: `Example(query="...", expected="...")`

**Integration with TermNorm:**
- Wrap TermNorm pipeline as DSPy `Module`:
  ```python
  class TermNormPipeline(dspy.Module):
      def forward(self, query: str):
          # Step 1: Entity profiling
          profile = self.entity_profiler(query)
          # Step 2: Token matching
          candidates = self.token_matcher(profile)
          # Step 3: LLM ranking
          ranked = self.ranker(profile, candidates)
          return dspy.Prediction(
              candidate=ranked[0]["candidate"],
              confidence=ranked[0]["relevance_score"],
              ranked_list=ranked
          )
  ```
- Use DSPy optimizers to improve prompts in steps 1 and 3
- Save compiled programs to MLflow artifacts with versioning

---

### 3. LangFuse-Compatible Trace Format

**LangFuse organizes observability around traces containing spans/generations/events.**

**Required Directory Structure:**
```
logs/mlruns/<experiment_id>/<run_id>/artifacts/traces/
└── <trace_id>/
    ├── trace.json                             # Root trace metadata
    ├── observations.jsonl                     # Spans/generations/events
    ├── scores.jsonl                           # Evaluation scores
    └── prompt_version.json                    # Linked prompt metadata
```

**Trace Format (`trace.json`):**
```json
{
  "id": "trace-uuid",
  "name": "research-and-match",
  "user_id": "192.168.1.100",
  "session_id": "session-123",
  "tags": ["optimization", "trial_003"],
  "metadata": {
    "campaign": "improve_material_extraction",
    "run_id": "mlflow-run-uuid"
  }
}
```

**Observations Format (`observations.jsonl`):**
```jsonl
{"type": "span", "name": "entity_profiling", "input": {"query": "stainless steel pipe"}, "output": {"core_concept": "..."}, "latency_ms": 5273}
{"type": "generation", "name": "llm_call_step1", "model": "groq/llama-3.3-70b", "prompt_version": "extraction_v3", "tokens": 1940, "temperature": 0.0}
{"type": "span", "name": "token_matching", "input": {"profile": {...}}, "output": {"num_candidates": 20}, "latency_ms": 15}
{"type": "generation", "name": "llm_call_step3", "model": "groq/llama-3.3-70b", "prompt_version": "reranker_v1", "tokens": 1650, "temperature": 0.0}
```

**Scores Format (`scores.jsonl`):**
```jsonl
{"name": "relevance", "value": 0.85, "data_type": "NUMERIC", "comment": "How well the result matches query intent"}
{"name": "hit_at_5", "value": true, "data_type": "BOOLEAN", "comment": "Expected answer in top 5"}
{"name": "mrr", "value": 1.0, "data_type": "NUMERIC", "comment": "Reciprocal rank of expected answer"}
```

**🚨 Key Rules:**
- ✅ Scores **MUST** have `name`, `value`, `data_type` (NUMERIC/BOOLEAN/CATEGORICAL)
- ✅ Every generation observation **MUST** link to prompt version via metadata
- ✅ Traces **MUST** capture latency, token usage, and tool/retrieval steps
- ✅ Spans **MUST** form a hierarchy (parent-child relationships)
- ✅ All observations **MUST** include timestamps

**Integration with TermNorm:**
- Extend `core/llm_providers.py:llm_call()` to emit LangFuse generation events
- Wrap pipeline steps in LangFuse spans:
  ```python
  from langfuse.decorators import observe

  @observe()
  async def web_generate_entity_profile(query: str):
      # LangFuse automatically creates span
      with langfuse.span(name="web_search") as span:
          results = await brave_search(query)
          span.update(output={"num_results": len(results)})
      # ... rest of function
  ```
- Store traces in MLflow artifacts for each trial

---

## STRATEGIC GITHUB MODELS INTEGRATION

> **✓ GitHub Models is COMPATIBLE with the above standards** when used as a:
> - Prompt storage format (`.prompt.yml` in MLflow artifacts)
> - Evaluation execution engine (`gh models eval --json`)
>
> **⚠️ GitHub Models is NOT COMPATIBLE** as a:
> - Primary architecture (no campaigns, no lineage tracking)
> - Replacement for MLflow experiments
> - DSPy program format
> - LangFuse trace format

### Where to Use GitHub Models Format

**✓ COMPATIBLE: Prompt Storage**

Store prompts as `.prompt.yml` files in MLflow artifacts directory. Use GitHub Models format inside MLflow runs:

```
mlruns/<experiment_id>/<run_id>/artifacts/prompt.yml  # GitHub Models format
```

**Benefit:** Version control via Git + MLflow tracking

**Example `prompt.yml` in MLflow Artifact:**
```yaml
name: "Trial 003: Step1 Enhanced Material Extraction"
description: "Enhanced material extraction with explicit instructions"
model: groq/llama-3.3-70b
modelParameters:
  temperature: 0.0
  max_tokens: 1000
messages:
  - role: system
    content: |
      You are an expert at extracting structured information about materials,
      products, and technical specifications from web content.
  - role: user
    content: |
      Query: {{query}}
      Web sources:
      {{web_content}}

      Extract a structured entity profile following the schema.
testData:
  - query: "stainless steel pipe"
    expected: "stainless piping"
evaluators:
  - name: "MRR threshold"
    uses: custom/mrr
    threshold: 0.8
```

**✓ COMPATIBLE: Evaluation Execution**

Use `gh models eval --json` to generate evaluation outputs, then transform into standards-compliant formats:

**Workflow:**
```python
import subprocess
import mlflow

# 1. Create prompt in GitHub Models format
prompt_yml = create_github_models_prompt(trial_config)
mlflow.log_artifact(prompt_yml, "prompt.yml")

# 2. Run evaluation via GitHub Models CLI
result = subprocess.run(
    ["gh", "models", "eval", "prompt.yml", "--json"],
    capture_output=True,
    text=True
)
eval_data = json.loads(result.stdout)

# 3. Transform & store in standards-compliant formats
# → MLflow metrics (aggregate scores)
mlflow.log_metrics({
    "mrr": calculate_mrr(eval_data),
    "hit_at_5": calculate_hit_at_k(eval_data, 5)
})

# → DSPy evaluation results (per-example)
save_dspy_results(eval_data, "evaluation_results.jsonl")

# → LangFuse traces (execution details)
save_langfuse_traces(eval_data, "traces/")
```

**⚠️ ADAPTATION REQUIRED: Campaign Management**

GitHub Models has no concept of optimization campaigns. **Solution:** Use MLflow Experiments to organize campaigns:

```python
import mlflow

# Campaign = MLflow Experiment
mlflow.set_experiment(f"optimization_{campaign_name}")

# Trial = MLflow Run
with mlflow.start_run(run_name=f"trial_{trial_id}"):
    # Track lineage via tags
    mlflow.set_tag("parent_trial", parent_id)
    mlflow.set_tag("variant_type", "step1_enhanced")

    # Log GitHub Models prompt
    mlflow.log_artifact("prompt.yml")

    # Run evaluation via GitHub Models
    result = subprocess.run(["gh", "models", "eval", "prompt.yml", "--json"])

    # Log to MLflow
    mlflow.log_metrics(extract_metrics(result))
    mlflow.log_artifact("results.json")
```

**⨯ NOT COMPATIBLE: Primary Architecture**

GitHub Models lacks:
- Built-in DSPy-style prompt optimization
- MLflow experiment tracking
- LangFuse trace format
- Hierarchical optimization tree persistence

**Conclusion:** Use GitHub Models as a tool within the MLflow/DSPy/LangFuse architecture, not as the architecture itself.

---

## UNIFIED HIERARCHY (Final Structure)

This is the **complete, final directory structure** that complies with all standards:

```
backend-api/logs/
│
├── mlruns/                                    # MLflow experiments (BACKBONE)
│   └── <experiment_id>/                       # Campaign (e.g., "improve_material_extraction")
│       ├── meta.yaml                          # Experiment metadata
│       │
│       ├── <trial_001_run_id>/                # Baseline trial
│       │   ├── meta.yaml                      # Run metadata
│       │   ├── params/                        # Configuration parameters
│       │   │   ├── step1_prompt_version
│       │   │   ├── step3_prompt_version
│       │   │   ├── model
│       │   │   └── temperature
│       │   ├── metrics/                       # Aggregate performance metrics
│       │   │   ├── mrr
│       │   │   ├── hit_at_5
│       │   │   ├── ndcg_at_5
│       │   │   └── avg_latency_ms
│       │   ├── tags/                          # Lineage tracking
│       │   │   ├── parent_trial              # null for baseline
│       │   │   ├── variant_type              # "baseline"
│       │   │   └── source_data               # "production_logs"
│       │   └── artifacts/
│       │       ├── prompt.yml                 # ✓ GitHub Models format
│       │       ├── dspy_program.json          # 🚨 DSPy compiled program
│       │       ├── trainset.jsonl             # Training examples
│       │       ├── devset.jsonl               # Validation examples
│       │       ├── evaluation_results.jsonl   # Per-example results
│       │       ├── aggregate_metrics.json     # Detailed metrics
│       │       ├── traces/                    # 🚨 LangFuse trace format
│       │       │   ├── trace_001/
│       │       │   │   ├── trace.json
│       │       │   │   ├── observations.jsonl
│       │       │   │   ├── scores.jsonl
│       │       │   │   └── prompt_version.json
│       │       │   └── trace_002/
│       │       │       └── ...
│       │       └── prompts/                   # Snapshot of prompts used
│       │           ├── step1_extraction_v2.txt
│       │           └── step3_reranker_v1.txt
│       │
│       ├── <trial_002_run_id>/                # Step 1 variant
│       │   ├── params/                        # step1_prompt_version: extraction_v3
│       │   ├── tags/
│       │   │   ├── parent_trial → trial_001_run_id
│       │   │   └── variant_type → "step1_enhanced"
│       │   └── artifacts/
│       │       └── ...
│       │
│       └── <trial_003_run_id>/                # Step 3 variant
│           └── ...
│
├── prompts/                                   # MLflow Prompt Registry
│   ├── entity_profiling/                      # Prompt family
│   │   ├── 1/
│   │   │   ├── metadata.json                  # {version: 1, created: ..., description: ...}
│   │   │   └── prompt.txt                     # Template with {{variables}}
│   │   ├── 2/
│   │   │   ├── metadata.json
│   │   │   └── prompt.yml                     # Can use GitHub Models format
│   │   └── 3/
│   │       └── ...
│   │
│   └── llm_ranking/                           # Prompt family
│       ├── 1/
│       └── 2/
│
├── datasets/                                  # Shared evaluation datasets
│   ├── match_test_cases.jsonl                 # DSPy Example format
│   ├── material_forms_v1.jsonl                # Category-specific datasets
│   └── specifications_v1.jsonl
│
├── activity.jsonl                             # [EXISTING] Production telemetry
└── match_database.json                        # [EXISTING] Identifier cache
```

**Annotations:**
- 🚨 **Non-negotiable formats** (MLflow, DSPy, LangFuse)
- ✓ **Optional/compatible formats** (GitHub Models)
- All directories follow industry standards for portability

---

## IMPLEMENTATION WORKFLOW

**Complete Python workflow showing standards-compliant optimization campaign:**

```python
import mlflow
import dspy
from langfuse import Langfuse
import subprocess
import json

# Initialize clients
langfuse = Langfuse()
mlflow.set_tracking_uri("file:./logs/mlruns")

# ============================================================================
# STEP 1: Initialize Campaign (MLflow Experiment)
# ============================================================================
experiment = mlflow.set_experiment("optimization_improve_material_extraction")

# ============================================================================
# STEP 2: Run Baseline Trial (MLflow Run)
# ============================================================================
with mlflow.start_run(run_name="trial_001_baseline") as run:
    # Log configuration
    mlflow.log_param("step1_prompt_version", "extraction_v2")
    mlflow.log_param("step3_prompt_version", "reranker_v1")
    mlflow.log_param("model", "groq/llama-3.3-70b")
    mlflow.log_param("temperature", 0.0)

    # Set tags for lineage
    mlflow.set_tag("parent_trial", None)
    mlflow.set_tag("variant_type", "baseline")
    mlflow.set_tag("source_data", "production_logs")

    # Load evaluation dataset (DSPy format)
    with open("logs/datasets/match_test_cases.jsonl", "r") as f:
        eval_dataset = [dspy.Example(**json.loads(line)) for line in f]

    # ========================================================================
    # STEP 3: Create Prompt in GitHub Models Format
    # ========================================================================
    prompt_yml = create_github_models_prompt({
        "name": "Trial 001: Baseline",
        "model": "groq/llama-3.3-70b",
        "temperature": 0.0,
        "step1_prompt": load_prompt("prompts/entity_profiling/2/prompt.txt"),
        "step3_prompt": load_prompt("prompts/llm_ranking/1/prompt.txt")
    })
    mlflow.log_artifact(prompt_yml, "prompt.yml")

    # ========================================================================
    # STEP 4: Wrap TermNorm Pipeline as DSPy Module
    # ========================================================================
    class TermNormPipeline(dspy.Module):
        def __init__(self):
            super().__init__()
            self.entity_profiler = dspy.ChainOfThought("query -> entity_profile")
            self.ranker = dspy.ChainOfThought("profile, candidates -> ranked_list")

        def forward(self, query: str):
            # Step 1: Entity profiling (with LangFuse tracing)
            with langfuse.span(name="entity_profiling") as span:
                profile = self.entity_profiler(query=query)
                span.update(output=profile)

            # Step 2: Token matching (deterministic)
            candidates = token_match(profile)

            # Step 3: LLM ranking (with LangFuse tracing)
            with langfuse.span(name="llm_ranking") as span:
                ranked = self.ranker(profile=profile, candidates=candidates)
                span.update(output=ranked)

            return dspy.Prediction(
                candidate=ranked.ranked_list[0],
                confidence=ranked.ranked_list[0].score
            )

    pipeline = TermNormPipeline()

    # ========================================================================
    # STEP 5: Run Evaluation with LangFuse Traces
    # ========================================================================
    results = []
    total_mrr = 0.0
    hits_at_5 = 0

    for example in eval_dataset:
        # Create LangFuse trace
        trace = langfuse.trace(
            name="research-and-match",
            input={"query": example.query},
            tags=["optimization", "trial_001"]
        )

        # Execute pipeline
        with trace:
            prediction = pipeline(query=example.query)

        # Calculate metrics
        rank = find_rank(prediction, example.expected)
        mrr = 1.0 / rank if rank else 0.0
        hit_at_5 = 1 if rank and rank <= 5 else 0

        total_mrr += mrr
        hits_at_5 += hit_at_5

        # Log scores to LangFuse
        trace.score(name="mrr", value=mrr, data_type="NUMERIC")
        trace.score(name="hit_at_5", value=hit_at_5, data_type="BOOLEAN")

        results.append({
            "query": example.query,
            "expected": example.expected,
            "predicted": prediction.candidate,
            "rank": rank,
            "mrr": mrr,
            "trace_id": trace.id
        })

    # ========================================================================
    # STEP 6: Save DSPy Program
    # ========================================================================
    pipeline.save("artifacts/dspy_program.json")
    mlflow.log_artifact("artifacts/dspy_program.json")

    # ========================================================================
    # STEP 7: Log Results to MLflow
    # ========================================================================
    # Per-example results (DSPy format)
    with open("artifacts/evaluation_results.jsonl", "w") as f:
        for result in results:
            f.write(json.dumps(result) + "\n")
    mlflow.log_artifact("artifacts/evaluation_results.jsonl")

    # Aggregate metrics
    num_cases = len(eval_dataset)
    metrics = {
        "mrr": total_mrr / num_cases,
        "hit_at_5": hits_at_5 / num_cases,
        "num_cases": num_cases
    }
    mlflow.log_metrics(metrics)

    # Save aggregate metrics file
    with open("artifacts/aggregate_metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    mlflow.log_artifact("artifacts/aggregate_metrics.json")

    print(f"✅ Baseline Trial Complete | MRR: {metrics['mrr']:.3f} | Hit@5: {metrics['hit_at_5']:.3f}")

# ============================================================================
# STEP 8: Run Variant Trial (Child Run)
# ============================================================================
with mlflow.start_run(run_name="trial_002_step1_enhanced") as run:
    # Log configuration (changed prompt version)
    mlflow.log_param("step1_prompt_version", "extraction_v3")  # ← Changed
    mlflow.log_param("step3_prompt_version", "reranker_v1")
    mlflow.log_param("model", "groq/llama-3.3-70b")
    mlflow.log_param("temperature", 0.0)

    # Set lineage tags
    mlflow.set_tag("parent_trial", baseline_run_id)
    mlflow.set_tag("variant_type", "step1_enhanced")
    mlflow.set_tag("changes", "Improved material extraction with explicit instructions")

    # ... repeat evaluation workflow ...

    # Compare to parent
    parent_metrics = mlflow.get_run(baseline_run_id).data.metrics
    improvement = metrics["mrr"] - parent_metrics["mrr"]
    mlflow.log_metric("improvement_over_parent", improvement)

    print(f"✅ Variant Trial Complete | MRR: {metrics['mrr']:.3f} | Improvement: {improvement:+.3f}")

# ============================================================================
# STEP 9: Optionally Use GitHub Models for Evaluation
# ============================================================================
# If you want to use GitHub Models CLI:
result = subprocess.run(
    ["gh", "models", "eval", "artifacts/prompt.yml", "--json"],
    capture_output=True,
    text=True
)
gh_models_result = json.loads(result.stdout)

# Transform GitHub Models output to MLflow/DSPy/LangFuse formats
mlflow.log_metrics(extract_metrics(gh_models_result))
save_dspy_results(gh_models_result, "artifacts/evaluation_results.jsonl")
save_langfuse_traces(gh_models_result, "artifacts/traces/")
```

---

## KEY TAKEAWAYS

1. **MLflow is your backbone**: Use it for experiment tracking (campaigns = experiments, trials = runs) and artifact storage. All optimization work must be logged through MLflow APIs.

2. **DSPy format for compiled programs**: Non-negotiable for portability—all optimized programs must be saved as `dspy_program.json`. This enables transfer between optimization frameworks and reproducibility.

3. **LangFuse format for traces**: Industry standard for observability—all execution traces must use the trace/observations/scores structure. This provides step-level debugging and performance analysis.

4. **GitHub Models as a tool**: Use `.prompt.yml` format in MLflow artifacts and leverage the CLI for evaluation execution, but don't depend on GitHub-specific features. GitHub Models is optional.

5. **Lineage via MLflow tags**: Track `parent_trial`, `variant_type`, and `source_data` in run tags instead of separate `lineage.json` files. This leverages MLflow's built-in capabilities.

**Result:** Full portability to MLflow/DSPy/LangFuse ecosystems while optionally taking advantage of GitHub Models' convenient prompt format and evaluation tooling.

---

## Current State Analysis

### Existing Backend Infrastructure

**Location:** `backend-api/`

**Core Components:**

1. **Logging System** (`core/logging.py`, `logs/activity.jsonl`)
   - ✅ JSON-based append-only logging
   - ✅ Captures LLM calls with latency/token tracking
   - ✅ Records training data (source → target mappings)
   - ❌ No trace IDs or span hierarchy
   - ❌ No experiment/run concept

2. **LLM Provider Abstraction** (`core/llm_providers.py`)
   - ✅ Supports Groq, OpenAI, Anthropic
   - ✅ Async/await ready
   - ✅ Retry logic with exponential backoff
   - ❌ No prompt versioning
   - ❌ No MLflow/LangFuse integration

3. **Three-Tier Matching Pipeline** (`api/research_pipeline.py`)
   - ✅ Exact cache → Fuzzy matching → LLM research
   - ✅ Structured confidence scores
   - ✅ Modular step architecture
   - ❌ No step-level tracing
   - ❌ No evaluation harness

4. **Research & Ranking** (`research_and_rank/`)
   - `web_generate_entity_profile.py` - Step 1 (LLM entity profiling)
   - `call_llm_for_ranking.py` - Step 3 (LLM candidate ranking)
   - ✅ Returns `(result, debug_info)` tuples
   - ❌ Prompts hardcoded in source files
   - ❌ No prompt registry

### Gaps for Prompt Optimization

**Critical Missing Components:**
- No MLflow experiment tracking
- No DSPy Module wrappers
- No LangFuse trace propagation
- No prompt versioning or registry
- No evaluation datasets
- No metric calculation (MRR, NDCG, Hit@K)
- No optimization campaign management

### Compatibility Assessment

| Component | MLflow Ready | DSPy Ready | LangFuse Ready |
|-----------|--------------|-----------|-----------------|
| LLM Provider | Partial (3/10) | No (2/10) | Partial (5/10) |
| Logging | Partial (6/10) | No (0/10) | Partial (5/10) |
| Pipeline | Yes (7/10) | Partial (4/10) | Partial (5/10) |
| Prompts | No (0/10) | No (0/10) | No (0/10) |
| Evaluation | No (0/10) | No (0/10) | No (0/10) |

**Overall Readiness:** Low (30% compatible)
**Work Required:** Significant integration effort across all three standards

---

## Target Architecture

> **🚨 NON-NEGOTIABLE CONSTRAINT: MLflow Structure**
> All optimization work must use the MLflow `mlruns/<experiment_id>/<run_id>/` hierarchy.
> Custom directory structures are not permitted.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    TERMNORM BACKEND API                         │
│                  (Production FastAPI Service)                    │
│                                                                   │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │  Web Research  │→ │ Entity Profile │→ │  LLM Ranking   │    │
│  │  & Scraping    │  │  Generation    │  │  & Matching    │    │
│  └────────────────┘  └────────────────┘  └────────────────┘    │
│                                                                   │
│  Logging: activity.jsonl (production telemetry)                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                   [Trace Data Flow]
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│              OPTIMIZATION SERVICE (Separate FastAPI)             │
│                                                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │                   MLflow Backend                      │       │
│  │  - Experiments (campaigns)                            │       │
│  │  - Runs (trials)                                      │       │
│  │  - Artifacts (prompts, programs, traces)              │       │
│  └──────────────────────────────────────────────────────┘       │
│                            ↕                                      │
│  ┌──────────────────────────────────────────────────────┐       │
│  │                    DSPy Optimizer                     │       │
│  │  - MIPROv2, BootstrapFewShot                          │       │
│  │  - Compiled program storage                           │       │
│  │  - Metric functions                                   │       │
│  └──────────────────────────────────────────────────────┘       │
│                            ↕                                      │
│  ┌──────────────────────────────────────────────────────┐       │
│  │                  LangFuse Observer                    │       │
│  │  - Trace collection                                   │       │
│  │  - Span instrumentation                               │       │
│  │  - Score recording                                    │       │
│  └──────────────────────────────────────────────────────┘       │
│                            ↕                                      │
│  ┌──────────────────────────────────────────────────────┐       │
│  │        Optional: GitHub Models Integration            │       │
│  │  - Prompt format (.yml)                               │       │
│  │  - Evaluation CLI (gh models eval)                    │       │
│  └──────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

**Production Backend:**
- Serves real-time matching requests
- Logs to `activity.jsonl` for production telemetry
- Maintains `match_database.json` cache
- **Does NOT** handle optimization campaigns

**Optimization Service:**
- Manages evaluation campaigns via MLflow
- Wraps pipeline in DSPy modules
- Collects LangFuse traces
- Calls production backend for evaluation
- Stores all artifacts in MLflow structure

### Data Flow

1. **Evaluation Request** → Optimization Service
2. **Campaign Setup** → MLflow creates experiment
3. **Trial Execution** → MLflow creates run
4. **Pipeline Invocation** → Calls production backend with `?trace=true`
5. **Trace Collection** → LangFuse records spans/generations
6. **Result Storage** → MLflow logs metrics/artifacts
7. **Program Saving** → DSPy serializes compiled program

---

## Implementation Phases

> **🚨 NON-NEGOTIABLE:** All phases must maintain compliance with MLflow/DSPy/LangFuse standards.

### Phase 1: Enhanced Logging Infrastructure (Week 1-2)

**Goal:** Add LangFuse-compatible tracing to production backend

**Tasks:**

1. **Install Dependencies**
   ```bash
   pip install langfuse mlflow dspy-ai
   ```

2. **Create Trace Logger Module** (`core/trace_logger.py`)
   ```python
   from langfuse import Langfuse
   from typing import Dict, Optional

   class TraceLogger:
       def __init__(self):
           self.langfuse = Langfuse()
           self.current_trace = None

       def start_trace(self, query: str, session_id: str):
           self.current_trace = self.langfuse.trace(
               name="research-and-match",
               input={"query": query},
               user_id=session_id,
               tags=["production"]
           )
           return self.current_trace

       def span(self, name: str):
           return self.current_trace.span(name=name)

       def generation(self, name: str, model: str, prompt_version: str):
           return self.current_trace.generation(
               name=name,
               model=model,
               metadata={"prompt_version": prompt_version}
           )

       def end_trace(self, output: Dict):
           self.current_trace.update(output=output)
   ```

3. **Instrument Pipeline Steps**

   Update `research_and_rank/web_generate_entity_profile.py`:
   ```python
   async def web_generate_entity_profile(query: str, trace_logger: Optional[TraceLogger] = None):
       if trace_logger:
           with trace_logger.span("web_search") as span:
               results = await brave_search(query)
               span.update(output={"num_results": len(results)})

           with trace_logger.generation("entity_profiling", "groq/llama-3.3-70b", "extraction_v2") as gen:
               profile = await llm_call(prompt, model="groq/llama-3.3-70b")
               gen.update(
                   input={"query": query, "web_content": results},
                   output=profile,
                   usage={"tokens": profile.tokens}
               )
       else:
           # Existing logic without tracing
           results = await brave_search(query)
           profile = await llm_call(prompt, model="groq/llama-3.3-70b")

       return profile
   ```

4. **Add Prompt Versioning**
   - Extract prompts to `backend-api/prompts/` directory
   - Create versioned prompt files:
     - `prompts/entity_profiling/2/prompt.txt`
     - `prompts/llm_ranking/1/prompt.txt`
   - Update LLM calls to include `prompt_version` parameter

5. **Feature Flag**
   ```python
   # config/settings.py
   ENABLE_TRACE_LOGGING = os.getenv("ENABLE_TRACE_LOGGING", "false").lower() == "true"
   ```

**Deliverable:** Production backend with optional LangFuse tracing (`/research-and-match?trace=true`)

---

### Phase 2: MLflow Experiment Structure (Week 3)

**Goal:** Set up MLflow backend and prompt registry

**Tasks:**

1. **Initialize MLflow Directory**
   ```bash
   mkdir -p backend-api/logs/mlruns
   mkdir -p backend-api/logs/prompts
   mkdir -p backend-api/logs/datasets
   ```

2. **Create MLflow Configuration** (`config/mlflow_config.py`)
   ```python
   import mlflow
   from pathlib import Path

   MLFLOW_TRACKING_URI = Path(__file__).parent.parent / "logs" / "mlruns"
   mlflow.set_tracking_uri(f"file:{MLFLOW_TRACKING_URI}")

   def get_or_create_experiment(name: str) -> str:
       experiment = mlflow.get_experiment_by_name(name)
       if experiment is None:
           experiment_id = mlflow.create_experiment(name)
       else:
           experiment_id = experiment.experiment_id
       return experiment_id
   ```

3. **Create Prompt Registry Manager** (`core/prompt_registry.py`)
   ```python
   from pathlib import Path
   import json

   class PromptRegistry:
       def __init__(self, base_path: Path = Path("logs/prompts")):
           self.base_path = base_path

       def register_prompt(self, name: str, version: int, content: str, metadata: dict):
           prompt_dir = self.base_path / name / str(version)
           prompt_dir.mkdir(parents=True, exist_ok=True)

           # Save prompt content
           with open(prompt_dir / "prompt.txt", "w") as f:
               f.write(content)

           # Save metadata
           with open(prompt_dir / "metadata.json", "w") as f:
               json.dump(metadata, f, indent=2)

       def load_prompt(self, name: str, version: int) -> str:
           prompt_file = self.base_path / name / str(version) / "prompt.txt"
           return prompt_file.read_text()

       def list_versions(self, name: str) -> list:
           prompt_dir = self.base_path / name
           if not prompt_dir.exists():
               return []
           return sorted([int(v.name) for v in prompt_dir.iterdir() if v.is_dir()])
   ```

4. **Migrate Existing Prompts**
   - Extract hardcoded prompts from `research_and_rank/*.py`
   - Register in prompt registry:
     ```python
     registry = PromptRegistry()
     registry.register_prompt(
         name="entity_profiling",
         version=2,
         content=ENTITY_PROFILING_PROMPT,
         metadata={
             "description": "Entity profile extraction from web content",
             "created": "2025-12-03",
             "author": "system"
         }
     )
     ```

5. **Create Evaluation Dataset**
   ```jsonl
   {"query": "stainless steel pipe", "expected": "stainless piping", "category": "material_forms"}
   {"query": "aluminum tube", "expected": "aluminum tubing", "category": "material_forms"}
   {"query": "carbon fiber sheet", "expected": "carbon fiber panels", "category": "material_forms"}
   ```

**Deliverable:** MLflow backend ready for experiment tracking, prompt registry populated

---

### Phase 3: DSPy Pipeline Wrapper (Week 4)

**Goal:** Wrap TermNorm pipeline as DSPy Module

**Tasks:**

1. **Create DSPy Module** (`core/dspy_pipeline.py`)
   ```python
   import dspy
   from typing import Dict, List

   class EntityProfiler(dspy.Signature):
       """Extract structured entity profile from query and web content."""
       query = dspy.InputField()
       web_content = dspy.InputField()
       entity_profile = dspy.OutputField(desc="Structured entity profile JSON")

   class CandidateRanker(dspy.Signature):
       """Rank candidates based on entity profile match."""
       entity_profile = dspy.InputField()
       candidates = dspy.InputField()
       ranked_list = dspy.OutputField(desc="List of ranked candidates with scores")

   class TermNormPipeline(dspy.Module):
       def __init__(self):
           super().__init__()
           self.profiler = dspy.ChainOfThought(EntityProfiler)
           self.ranker = dspy.ChainOfThought(CandidateRanker)

       def forward(self, query: str):
           # Step 1: Web research & entity profiling
           web_results = self.web_search(query)
           profile = self.profiler(
               query=query,
               web_content=web_results
           )

           # Step 2: Token matching (deterministic)
           candidates = self.token_match(profile.entity_profile)

           # Step 3: LLM ranking
           ranked = self.ranker(
               entity_profile=profile.entity_profile,
               candidates=candidates
           )

           return dspy.Prediction(
               candidate=ranked.ranked_list[0],
               confidence=ranked.ranked_list[0]["relevance_score"],
               ranked_list=ranked.ranked_list
           )

       def web_search(self, query: str) -> str:
           # Delegate to existing web research module
           from research_and_rank.web_generate_entity_profile import brave_search
           results = brave_search(query)
           return "\n".join([r["snippet"] for r in results])

       def token_match(self, profile: Dict) -> List[str]:
           # Delegate to existing token matching logic
           from research_and_rank.call_llm_for_ranking import fuzzy_match_candidates
           return fuzzy_match_candidates(profile, reference_terms)
   ```

2. **Create Metric Functions** (`core/metrics.py`)
   ```python
   def calculate_mrr(results: List[Dict]) -> float:
       """Mean Reciprocal Rank"""
       total = sum(1.0 / r["rank"] if r["rank"] else 0 for r in results)
       return total / len(results)

   def calculate_hit_at_k(results: List[Dict], k: int) -> float:
       """Hit@K: Percentage of queries where expected is in top K"""
       hits = sum(1 for r in results if r["rank"] and r["rank"] <= k)
       return hits / len(results)

   def calculate_ndcg_at_k(results: List[Dict], k: int) -> float:
       """Normalized Discounted Cumulative Gain at K"""
       # Implementation details...
       pass

   def termnorm_metric(example, pred, trace=None) -> bool:
       """DSPy-compatible metric function"""
       return pred.candidate == example.expected
   ```

3. **Test DSPy Serialization**
   ```python
   # Test saving/loading
   pipeline = TermNormPipeline()
   pipeline.save("test_program.json")

   loaded_pipeline = TermNormPipeline()
   loaded_pipeline.load("test_program.json")

   # Verify predictions match
   assert pipeline(query="test") == loaded_pipeline(query="test")
   ```

**Deliverable:** TermNorm pipeline wrapped as DSPy Module with serialization

---

### Phase 4: Evaluation Harness (Week 5)

**Goal:** Build MLflow-based evaluation system

**Tasks:**

1. **Create Evaluation Runner** (`core/evaluation_runner.py`)
   ```python
   import mlflow
   import dspy
   from pathlib import Path
   from typing import Dict, List
   from langfuse import Langfuse

   class EvaluationRunner:
       def __init__(self, experiment_name: str):
           self.experiment_name = experiment_name
           self.langfuse = Langfuse()
           mlflow.set_experiment(experiment_name)

       async def run_trial(
           self,
           trial_name: str,
           pipeline: dspy.Module,
           dataset: List[dspy.Example],
           parent_trial: str = None
       ) -> Dict:
           with mlflow.start_run(run_name=trial_name) as run:
               # Log configuration
               mlflow.log_param("num_samples", len(dataset))
               if parent_trial:
                   mlflow.set_tag("parent_trial", parent_trial)

               # Run evaluation
               results = []
               for example in dataset:
                   trace = self.langfuse.trace(
                       name="research-and-match",
                       input={"query": example.query},
                       tags=["evaluation", trial_name]
                   )

                   with trace:
                       pred = pipeline(query=example.query)

                   rank = self.find_rank(pred, example.expected)
                   mrr = 1.0 / rank if rank else 0.0

                   trace.score(name="mrr", value=mrr, data_type="NUMERIC")
                   trace.score(name="hit_at_5", value=rank <= 5 if rank else False, data_type="BOOLEAN")

                   results.append({
                       "query": example.query,
                       "expected": example.expected,
                       "predicted": pred.candidate,
                       "rank": rank,
                       "mrr": mrr,
                       "trace_id": trace.id
                   })

               # Calculate aggregate metrics
               metrics = {
                   "mrr": calculate_mrr(results),
                   "hit_at_5": calculate_hit_at_k(results, 5),
                   "ndcg_at_5": calculate_ndcg_at_k(results, 5)
               }

               # Log to MLflow
               mlflow.log_metrics(metrics)

               # Save artifacts
               pipeline.save("artifacts/dspy_program.json")
               mlflow.log_artifact("artifacts/dspy_program.json")

               with open("artifacts/evaluation_results.jsonl", "w") as f:
                   for result in results:
                       f.write(json.dumps(result) + "\n")
               mlflow.log_artifact("artifacts/evaluation_results.jsonl")

               return {
                   "run_id": run.info.run_id,
                   "metrics": metrics,
                   "results": results
               }
   ```

2. **Create Evaluation API Endpoint** (`api/evaluation.py`)
   ```python
   from fastapi import APIRouter, HTTPException
   from pydantic import BaseModel

   router = APIRouter(prefix="/evaluate", tags=["evaluation"])

   class EvaluationRequest(BaseModel):
       campaign_name: str
       trial_name: str
       dataset_file: str
       prompt_versions: Dict[str, str]
       parent_trial: Optional[str] = None

   @router.post("/run-trial")
   async def run_evaluation_trial(req: EvaluationRequest):
       # Load dataset
       dataset = load_dspy_dataset(req.dataset_file)

       # Create pipeline with specified prompts
       pipeline = create_pipeline_with_prompts(req.prompt_versions)

       # Run evaluation
       runner = EvaluationRunner(req.campaign_name)
       result = await runner.run_trial(
           trial_name=req.trial_name,
           pipeline=pipeline,
           dataset=dataset,
           parent_trial=req.parent_trial
       )

       return result
   ```

**Deliverable:** MLflow-based evaluation harness with API endpoints

---

### Phase 5: Optimization Campaign Management (Week 6)

**Goal:** Implement DSPy optimization workflows

**Tasks:**

1. **Create DSPy Optimizer Wrapper** (`core/dspy_optimizer.py`)
   ```python
   from dspy.teleprompt import BootstrapFewShot, MIPROv2
   import mlflow

   class CampaignOptimizer:
       def __init__(self, experiment_name: str):
           self.experiment_name = experiment_name
           mlflow.set_experiment(experiment_name)

       def optimize_with_mipro(
           self,
           pipeline: dspy.Module,
           trainset: List[dspy.Example],
           metric: callable
       ):
           with mlflow.start_run(run_name="mipro_optimization") as run:
               optimizer = MIPROv2(
                   metric=metric,
                   num_candidates=10,
                   init_temperature=1.0
               )

               optimized = optimizer.compile(
                   student=pipeline,
                   trainset=trainset,
                   num_trials=20
               )

               # Save optimized program
               optimized.save("artifacts/dspy_program_optimized.json")
               mlflow.log_artifact("artifacts/dspy_program_optimized.json")

               # Log optimizer config
               mlflow.log_params({
                   "optimizer": "MIPROv2",
                   "num_candidates": 10,
                   "num_trials": 20
               })

               return optimized
   ```

2. **Create Campaign Management API** (`api/campaigns.py`)
   ```python
   @router.post("/campaigns/create")
   async def create_campaign(req: CampaignRequest):
       # Create MLflow experiment
       experiment_id = get_or_create_experiment(req.campaign_name)

       # Run baseline trial
       baseline_result = await run_baseline_trial(req)

       # Launch optimization
       if req.optimizer_config:
           optimizer = CampaignOptimizer(req.campaign_name)
           optimized_pipeline = optimizer.optimize_with_mipro(
               pipeline=baseline_pipeline,
               trainset=load_trainset(req.dataset),
               metric=termnorm_metric
           )

       return {
           "experiment_id": experiment_id,
           "baseline_run_id": baseline_result["run_id"],
           "baseline_metrics": baseline_result["metrics"]
       }

   @router.get("/campaigns/{campaign_name}/status")
   async def get_campaign_status(campaign_name: str):
       experiment = mlflow.get_experiment_by_name(campaign_name)
       runs = mlflow.search_runs(experiment_ids=[experiment.experiment_id])

       return {
           "experiment_id": experiment.experiment_id,
           "num_trials": len(runs),
           "best_run": runs.sort_values("metrics.mrr", ascending=False).iloc[0].to_dict()
       }
   ```

**Deliverable:** Full optimization campaign system with DSPy integration

---

### Phase 6: GitHub Models Integration (Optional, Week 7)

**Goal:** Add GitHub Models format support

**Tasks:**

1. **Create GitHub Models Prompt Converter** (`utils/github_models_converter.py`)
   ```python
   import yaml

   def convert_to_github_models_format(
       trial_name: str,
       prompts: Dict[str, str],
       model: str,
       temperature: float,
       testdata: List[Dict]
   ) -> str:
       prompt_yml = {
           "name": trial_name,
           "description": f"Generated from MLflow trial",
           "model": model,
           "modelParameters": {
               "temperature": temperature,
               "max_tokens": 1000
           },
           "messages": [
               {"role": "system", "content": prompts["system"]},
               {"role": "user", "content": prompts["user"]}
           ],
           "testData": testdata,
           "evaluators": [
               {"name": "MRR threshold", "uses": "custom/mrr", "threshold": 0.8}
           ]
       }
       return yaml.dump(prompt_yml)

   def export_trial_to_github_models(run_id: str):
       run = mlflow.get_run(run_id)
       # Extract prompts from artifacts
       prompts = load_prompts_from_artifacts(run_id)
       # Convert to GitHub Models format
       yml = convert_to_github_models_format(...)
       # Save to artifacts
       mlflow.log_text(yml, "prompt.yml")
   ```

2. **Add Export Endpoint**
   ```python
   @router.get("/trials/{run_id}/export/github-models")
   async def export_to_github_models(run_id: str):
       yml = export_trial_to_github_models(run_id)
       return Response(content=yml, media_type="application/x-yaml")
   ```

**Deliverable:** GitHub Models format export/import capability

---

## Data Format Specifications

> **🚨 NON-NEGOTIABLE:** All data must follow MLflow/DSPy/LangFuse formats.

### MLflow Run Metadata

**Location:** `mlruns/<experiment_id>/<run_id>/meta.yaml`

**Format:**
```yaml
artifact_uri: file:///path/to/mlruns/1/abc123/artifacts
end_time: 1733270400000
entry_point_name: ''
experiment_id: '1'
lifecycle_stage: active
run_id: abc123def456
run_name: trial_001_baseline
run_uuid: abc123def456
source_name: ''
source_type: 4
source_version: ''
start_time: 1733270100000
status: 3
tags:
  - key: parent_trial
    value: null
  - key: variant_type
    value: baseline
user_id: system
```

### DSPy Program Format

**Location:** `mlruns/<experiment_id>/<run_id>/artifacts/dspy_program.json`

**Format:**
```json
{
  "name": "TermNormPipeline",
  "modules": {
    "profiler": {
      "type": "ChainOfThought",
      "signature": "EntityProfiler",
      "prompt": "..."
    },
    "ranker": {
      "type": "ChainOfThought",
      "signature": "CandidateRanker",
      "prompt": "..."
    }
  },
  "forward_fn": "...",
  "config": {
    "model": "groq/llama-3.3-70b",
    "temperature": 0.0
  }
}
```

### LangFuse Trace Format

**Location:** `mlruns/<experiment_id>/<run_id>/artifacts/traces/<trace_id>/`

**trace.json:**
```json
{
  "id": "trace-uuid-abc123",
  "name": "research-and-match",
  "timestamp": "2025-12-03T10:00:00Z",
  "user_id": "192.168.1.100",
  "session_id": "session-xyz789",
  "tags": ["evaluation", "trial_001"],
  "metadata": {
    "campaign": "improve_material_extraction",
    "run_id": "abc123def456"
  },
  "input": {
    "query": "stainless steel pipe"
  },
  "output": {
    "candidate": "stainless piping",
    "confidence": 0.95
  }
}
```

**observations.jsonl:**
```jsonl
{"id": "obs-1", "type": "span", "name": "web_search", "parent_id": null, "start_time": "2025-12-03T10:00:00.100Z", "end_time": "2025-12-03T10:00:00.220Z", "input": {"query": "stainless steel pipe"}, "output": {"num_results": 7}, "metadata": {}}
{"id": "obs-2", "type": "generation", "name": "entity_profiling", "parent_id": "obs-1", "start_time": "2025-12-03T10:00:00.250Z", "end_time": "2025-12-03T10:00:05.523Z", "model": "groq/llama-3.3-70b", "prompt_version": "extraction_v2", "input": {"query": "...", "web_content": "..."}, "output": {"core_concept": "..."}, "usage": {"tokens": 1940, "latency_ms": 5273}}
{"id": "obs-3", "type": "span", "name": "token_matching", "parent_id": null, "start_time": "2025-12-03T10:00:05.540Z", "end_time": "2025-12-03T10:00:05.555Z", "input": {"profile": {...}}, "output": {"num_candidates": 20}, "metadata": {}}
{"id": "obs-4", "type": "generation", "name": "llm_ranking", "parent_id": "obs-3", "start_time": "2025-12-03T10:00:05.560Z", "end_time": "2025-12-03T10:00:10.380Z", "model": "groq/llama-3.3-70b", "prompt_version": "reranker_v1", "input": {"profile": {...}, "candidates": [...]}, "output": {"ranked_list": [...]}, "usage": {"tokens": 1650, "latency_ms": 4820}}
```

**scores.jsonl:**
```jsonl
{"name": "mrr", "value": 1.0, "data_type": "NUMERIC", "comment": "Reciprocal rank of expected answer"}
{"name": "hit_at_5", "value": true, "data_type": "BOOLEAN", "comment": "Expected answer in top 5"}
{"name": "relevance", "value": 0.95, "data_type": "NUMERIC", "comment": "LLM confidence score"}
```

---

## Integration Points

### Separate FastAPI Project for Optimization

**Rationale:** Keep production backend lean, optimization tools in separate service

**Project Structure:**
```
termnorm-optimizer/                    # NEW optimization service
├── main.py                            # FastAPI app
├── requirements.txt                   # mlflow, dspy-ai, langfuse
├── api/
│   ├── campaigns.py                   # Campaign management
│   ├── trials.py                      # Trial execution
│   ├── export.py                      # Format conversion
│   └── evaluation.py                  # Evaluation endpoints
├── core/
│   ├── evaluation_runner.py           # MLflow-based evaluation
│   ├── dspy_pipeline.py               # TermNorm DSPy Module
│   ├── dspy_optimizer.py              # DSPy optimization wrappers
│   ├── trace_logger.py                # LangFuse integration
│   ├── prompt_registry.py             # MLflow prompt management
│   └── metrics.py                     # Metric calculations
└── utils/
    └── github_models_converter.py     # Optional GitHub Models export
```

**Communication:**
- Optimizer service calls production backend's `/research-and-match?trace=true`
- Reads/writes to shared `logs/` directory (mounted volume in Docker)
- Optional: Use message queue (Redis) for async trial execution

**Benefits:**
- Production backend stays simple (no heavy ML dependencies)
- Optimization service can use DSPy, MLflow, LangFuse without affecting production
- Independent scaling

### DSPy Integration

**Wrapping TermNorm Pipeline:**

```python
import dspy

# Define signatures
class EntityProfiler(dspy.Signature):
    """Extract structured entity profile."""
    query = dspy.InputField()
    web_content = dspy.InputField()
    entity_profile = dspy.OutputField()

# Wrap in DSPy Module
class TermNormPipeline(dspy.Module):
    def __init__(self):
        super().__init__()
        self.profiler = dspy.ChainOfThought(EntityProfiler)
        self.ranker = dspy.ChainOfThought(CandidateRanker)

    def forward(self, query: str):
        # ... pipeline logic ...
        return dspy.Prediction(candidate=..., confidence=...)

# Save compiled program to MLflow
pipeline = TermNormPipeline()
pipeline.save("mlruns/1/abc123/artifacts/dspy_program.json")
```

**Using DSPy Optimizers:**

```python
from dspy.teleprompt import MIPROv2

# Define metric
def termnorm_metric(example, pred, trace=None):
    return pred.candidate == example.expected

# Run optimization
optimizer = MIPROv2(metric=termnorm_metric, num_candidates=10)
optimized_pipeline = optimizer.compile(
    student=pipeline,
    trainset=trainset,
    num_trials=20
)

# Log to MLflow
with mlflow.start_run():
    optimized_pipeline.save("artifacts/dspy_program.json")
    mlflow.log_artifact("artifacts/dspy_program.json")
```

### LangFuse Integration

**Automatic Span Creation:**

```python
from langfuse.decorators import observe

@observe()
async def web_generate_entity_profile(query: str):
    # LangFuse automatically creates span
    results = await brave_search(query)
    profile = await llm_call(prompt)
    return profile
```

**Manual Trace Creation:**

```python
from langfuse import Langfuse

langfuse = Langfuse()

trace = langfuse.trace(
    name="research-and-match",
    input={"query": "stainless steel pipe"},
    tags=["production"]
)

with trace.span(name="web_search") as span:
    results = await brave_search(query)
    span.update(output={"num_results": len(results)})

with trace.generation(name="entity_profiling", model="groq/llama-3.3-70b") as gen:
    profile = await llm_call(prompt)
    gen.update(
        input={"query": query, "web_content": results},
        output=profile,
        usage={"tokens": 1940}
    )

trace.score(name="mrr", value=1.0, data_type="NUMERIC")
```

**Storing Traces in MLflow:**

```python
# Save LangFuse traces to MLflow artifacts
trace_dir = Path(f"mlruns/{experiment_id}/{run_id}/artifacts/traces/{trace.id}")
trace_dir.mkdir(parents=True, exist_ok=True)

with open(trace_dir / "trace.json", "w") as f:
    json.dump(trace.get(), f, indent=2)

with open(trace_dir / "observations.jsonl", "w") as f:
    for obs in trace.get_observations():
        f.write(json.dumps(obs) + "\n")

with open(trace_dir / "scores.jsonl", "w") as f:
    for score in trace.get_scores():
        f.write(json.dumps(score) + "\n")

mlflow.log_artifacts(str(trace_dir), artifact_path=f"traces/{trace.id}")
```

---

## Migration Path

### Backward Compatibility

**Production API:**
- ✅ No breaking changes to `/research-and-match` endpoint
- ✅ Trace logging is opt-in (`?trace=true`)
- ✅ Existing `activity.jsonl` logging continues unchanged

**Optimization Service:**
- ✅ All optimization endpoints under `/optimize/*` (separate namespace)
- ✅ Can run alongside production without conflicts
- ✅ Reads production data without modifying it

### Gradual Rollout Strategy

**Week 1-2: Enhanced Logging**
- Deploy LangFuse instrumentation to production (feature flag off)
- Test trace collection in staging environment
- Validate trace format compliance

**Week 3: MLflow Setup**
- Initialize MLflow backend
- Migrate prompts to registry
- Create baseline evaluation dataset

**Week 4: DSPy Integration**
- Wrap pipeline in DSPy Module
- Test serialization/deserialization
- Validate metric functions

**Week 5: First Evaluation**
- Run baseline evaluation on production prompts
- Establish benchmark metrics (MRR, Hit@5)
- Identify failure categories

**Week 6: First Optimization Campaign**
- Launch campaign with 1-2 manual variants
- Use breadth-first strategy (one change per trial)
- Validate MLflow lineage tracking

**Week 7+: Continuous Optimization**
- Scheduled weekly evaluation runs
- Automated DSPy optimization campaigns
- Monitor production metrics vs. evaluation metrics

---

## Security & Performance Considerations

### Security

1. **Authentication:**
   - Optimization endpoints require admin API key
   - Separate from production IP-based auth
   - Rate limit evaluation endpoints

2. **Data Privacy:**
   - No sensitive customer data in test datasets
   - Anonymize query logs before optimization
   - Store prompts/traces in encrypted storage

3. **API Key Management:**
   - Never commit `.env` files
   - Use environment variables for production
   - Rotate keys regularly

### Performance

1. **Production Impact:**
   - Trace logging adds ~50ms overhead (only when enabled via `?trace=true`)
   - Evaluation runs use separate worker pool
   - No impact on production `/research-and-match` throughput

2. **Storage:**
   - MLflow artifacts can grow large (estimate 10MB per 100 queries)
   - Implement log rotation (keep last 90 days)
   - Compress old traces (gzip)

3. **Cost Optimization:**
   - Cache evaluation results (don't re-run identical configs)
   - Sample large datasets for quick iterations
   - Use cheaper models for preliminary trials (Groq > OpenAI)

---

## Success Metrics

### Evaluation Harness
- ✅ Baseline MRR > 0.80 established
- ✅ Evaluation runs complete in <10 minutes for 50-query dataset
- ✅ Failure analysis identifies top 3 error categories

### Optimization Campaigns
- ✅ MRR improvement > 0.05 from baseline
- ✅ Hit@5 improvement > 0.02 from baseline
- ✅ Optimization campaigns complete in <2 hours (20 trials)

### Tool Integration
- ✅ MLflow UI displays all trials with metrics
- ✅ DSPy programs serialize/deserialize correctly
- ✅ LangFuse traces show step-level performance

### Production Adoption
- ✅ Top-performing prompts deployed to production
- ✅ Production MRR matches evaluation MRR (within 0.02)
- ✅ Automated regression tests catch prompt degradation

---

## References

- [MLflow GenAI Documentation](https://mlflow.org/docs/latest/llms/index.html)
- [MLflow Prompt Registry](https://mlflow.org/docs/latest/llms/prompt-engineering/index.html)
- [DSPy Documentation](https://dspy.ai)
- [DSPy MIPROv2 Optimizer](https://dspy.ai/deep-dive/teleprompter/mipro)
- [LangFuse Tracing](https://langfuse.com/docs/tracing)
- [LangFuse Python SDK](https://langfuse.com/docs/sdk/python)
- [GitHub Models Documentation](https://github.com/features/models) (optional integration)

---

## Appendix: Example Code Snippets

### Complete Evaluation Script

```python
import mlflow
import dspy
from langfuse import Langfuse
from pathlib import Path
import json

# Initialize
mlflow.set_tracking_uri("file:./logs/mlruns")
langfuse = Langfuse()

# Create experiment
experiment = mlflow.set_experiment("optimization_improve_material_extraction")

# Load dataset
with open("logs/datasets/match_test_cases.jsonl", "r") as f:
    dataset = [dspy.Example(**json.loads(line)) for line in f]

# Define pipeline
class TermNormPipeline(dspy.Module):
    def __init__(self):
        super().__init__()
        self.profiler = dspy.ChainOfThought("query, web_content -> entity_profile")
        self.ranker = dspy.ChainOfThought("profile, candidates -> ranked_list")

    def forward(self, query: str):
        # Step 1: Entity profiling
        profile = self.profiler(query=query, web_content=self.web_search(query))

        # Step 2: Token matching
        candidates = self.token_match(profile)

        # Step 3: LLM ranking
        ranked = self.ranker(profile=profile, candidates=candidates)

        return dspy.Prediction(
            candidate=ranked.ranked_list[0],
            confidence=ranked.ranked_list[0]["score"]
        )

    def web_search(self, query: str) -> str:
        # Delegate to production backend
        response = requests.get(f"http://localhost:8000/web-search?q={query}")
        return response.json()["content"]

    def token_match(self, profile) -> list:
        # Delegate to production backend
        response = requests.post("http://localhost:8000/token-match", json=profile)
        return response.json()["candidates"]

# Run evaluation
pipeline = TermNormPipeline()

with mlflow.start_run(run_name="trial_001_baseline") as run:
    # Log configuration
    mlflow.log_param("step1_prompt_version", "extraction_v2")
    mlflow.log_param("step3_prompt_version", "reranker_v1")
    mlflow.log_param("model", "groq/llama-3.3-70b")

    # Set tags
    mlflow.set_tag("parent_trial", None)
    mlflow.set_tag("variant_type", "baseline")

    # Evaluate
    results = []
    total_mrr = 0.0
    hits_at_5 = 0

    for example in dataset:
        # Create LangFuse trace
        trace = langfuse.trace(
            name="research-and-match",
            input={"query": example.query},
            tags=["evaluation", "trial_001"]
        )

        with trace:
            pred = pipeline(query=example.query)

        # Calculate metrics
        rank = find_rank(pred.candidate, example.expected)
        mrr = 1.0 / rank if rank else 0.0
        hit_at_5 = 1 if rank and rank <= 5 else 0

        total_mrr += mrr
        hits_at_5 += hit_at_5

        # Log scores
        trace.score(name="mrr", value=mrr, data_type="NUMERIC")
        trace.score(name="hit_at_5", value=hit_at_5, data_type="BOOLEAN")

        results.append({
            "query": example.query,
            "expected": example.expected,
            "predicted": pred.candidate,
            "rank": rank,
            "mrr": mrr,
            "trace_id": trace.id
        })

    # Calculate aggregate metrics
    num_cases = len(dataset)
    metrics = {
        "mrr": total_mrr / num_cases,
        "hit_at_5": hits_at_5 / num_cases,
        "num_cases": num_cases
    }

    # Log to MLflow
    mlflow.log_metrics(metrics)

    # Save DSPy program
    pipeline.save("artifacts/dspy_program.json")
    mlflow.log_artifact("artifacts/dspy_program.json")

    # Save evaluation results
    with open("artifacts/evaluation_results.jsonl", "w") as f:
        for result in results:
            f.write(json.dumps(result) + "\n")
    mlflow.log_artifact("artifacts/evaluation_results.jsonl")

    print(f"✅ Evaluation Complete | MRR: {metrics['mrr']:.3f} | Hit@5: {metrics['hit_at_5']:.3f}")
    print(f"📊 MLflow Run ID: {run.info.run_id}")
    print(f"🔗 View in MLflow: http://localhost:5000/#/experiments/{experiment.experiment_id}/runs/{run.info.run_id}")
```

### MLflow UI Launch

```bash
# Launch MLflow UI
cd backend-api/logs
mlflow ui

# View experiments at http://localhost:5000
```

---

*Document Version: 2.0*
*Last Updated: 2025-12-03*
*Author: AI Strategy Team*
*Standards Compliance: MLflow ✅ | DSPy ✅ | LangFuse ✅*
