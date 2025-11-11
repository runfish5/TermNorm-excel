# TermNorm Evaluation Framework

MLflow-based evaluation and experiment tracking infrastructure for prompt optimization and pipeline monitoring.

## Overview

This evaluation framework provides:

- **Experiment Tracking**: MLflow-based tracking of all prompt variants and pipeline runs
- **Ranking Metrics**: Standard IR metrics (MRR, NDCG, Hit@K) for evaluating ranking quality
- **Component Monitoring**: Track individual pipeline stages (web search, fuzzy matching, LLM ranking)
- **Structured Storage**: All run variables, parameters, and results stored systematically
- **Minimal Integration**: Adapter pattern requires minimal changes to production code

## Directory Structure

```
evaluation/
├── adapters/               # Framework integration adapters
│   ├── mlflow_adapter.py  # MLflow tracking wrapper
│   └── __init__.py
├── experiments/            # Experiment definitions
│   └── __init__.py
├── configs/                # Experiment configurations
│   ├── prompts/           # Prompt template versions
│   └── test_datasets.json # Test cases
├── metrics/                # Custom evaluation metrics
│   ├── ranking_quality.py # MRR, NDCG, Hit@K implementations
│   └── __init__.py
├── scripts/                # Execution scripts
│   ├── run_experiment.py  # Main experiment runner
│   └── extract_test_cases.py # Parse activity logs
├── analysis/               # Post-experiment analysis
│   └── __init__.py
└── README.md              # This file
```

## Installation

### 1. Install Dependencies

```bash
cd backend-api
pip install -r requirements.txt
```

This installs:
- `mlflow==2.16.2` - Experiment tracking framework
- `pandas` - Data analysis

### 2. Verify Installation

```bash
mlflow --version
```

## Quick Start

### Option 1: Run Experiments (Without Starting Server)

The fastest way to test prompt variants using direct script execution:

```bash
cd backend-api

# Load environment
# Windows:
.\venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Run experiment
python evaluation/scripts/run_experiment.py
```

This will:
1. Load test cases from `evaluation/configs/test_datasets.json`
2. Run each test case through the pipeline
3. Track all parameters and metrics in MLflow
4. Calculate aggregate statistics (MRR, Hit@K, etc.)

### Option 2: Track Production Requests (With Server Running)

To track all production API requests automatically:

1. **Integrate tracking into endpoint** (one-time setup):

```python
# In backend-api/api/research_pipeline.py
from evaluation.adapters.mlflow_adapter import tracker

@router.post("/research-and-match")
@tracker.track_pipeline("research_and_match")  # Add this decorator
async def research_and_match(request: Request, payload: Dict[str, Any] = Body(...)):
    # Existing code unchanged
    ...
```

2. **Start server normally**:

```bash
cd backend-api
python -m uvicorn main:app --reload
```

Now all requests will be automatically tracked!

### View Results

```bash
cd backend-api
mlflow ui --port 5000
```

Open browser to: `http://localhost:5000`

## Usage Examples

### Running Experiments

**Basic experiment run:**
```bash
python evaluation/scripts/run_experiment.py
```

**Run with custom test file:**
```bash
python evaluation/scripts/run_experiment.py --test-file path/to/tests.json
```

**Run specific variant:**
```bash
python evaluation/scripts/run_experiment.py --variant enhanced_v2
```

**Compare multiple variants:**
```bash
python evaluation/scripts/run_experiment.py --compare
```

**Verbose output:**
```bash
python evaluation/scripts/run_experiment.py -v
```

### Extracting Test Cases from Logs

Extract test cases from `logs/activity.jsonl`:

```bash
python evaluation/scripts/extract_test_cases.py
```

**Options:**
```bash
# Include all queries (not just ones with user selections)
python evaluation/scripts/extract_test_cases.py --all-queries

# Categorize by query type
python evaluation/scripts/extract_test_cases.py --categorize

# Custom log file
python evaluation/scripts/extract_test_cases.py --log-file ../logs/activity.jsonl

# Save as JSONL instead of JSON
python evaluation/scripts/extract_test_cases.py --jsonl
```

### Analyzing Results Programmatically

```python
from evaluation.adapters.mlflow_adapter import TermNormMLflowAdapter

# Create adapter
tracker = TermNormMLflowAdapter()

# Get experiment summary
summary = tracker.get_experiment_summary()
print(f"Total runs: {summary['total_runs']}")
print(f"Avg time: {summary['avg_total_time_seconds']:.2f}s")

# Get best run by metric
best_run_id = tracker.get_best_run("top1_core_score", ascending=False)
print(f"Best run ID: {best_run_id}")

# Compare specific runs
comparison = tracker.compare_runs([run_id_1, run_id_2])
for run_data in comparison:
    print(f"Run: {run_data['run_name']}")
    print(f"  MRR: {run_data['metrics'].get('mean_reciprocal_rank', 'N/A')}")
```

## Test Dataset Format

Test cases in `configs/test_datasets.json` should follow this structure:

```json
[
  {
    "query": "stainless steel pipe",
    "terms": [
      "steel pipe",
      "stainless tube",
      "metal conduit",
      "ss pipe",
      "stainless piping"
    ],
    "expected_match": "stainless piping",
    "category": "materials"
  }
]
```

**Required fields:**
- `query`: The search query
- `terms`: List of candidate terms to rank

**Optional fields:**
- `expected_match`: Known correct answer (for calculating metrics)
- `category`: Query category for analysis
- `source_timestamp`: When the test case was created
- `source_web_search_status`: Original web search status

## Metrics Explained

### Mean Reciprocal Rank (MRR)

Measures the average position of the first correct answer:
- MRR = 1.0: Correct answer always at position 1
- MRR = 0.5: Correct answer typically at position 2
- MRR = 0.0: Correct answer never found

**Formula:** `MRR = (1/N) * Σ(1/rank_i)`

### Hit@K

Percentage of queries where the correct answer appears in the top K results:
- Hit@1: Correct answer in top 1
- Hit@5: Correct answer in top 5
- Hit@10: Correct answer in top 10

### NDCG@K (Normalized Discounted Cumulative Gain)

Measures ranking quality with position-based discounting:
- NDCG = 1.0: Perfect ranking
- NDCG = 0.5: Moderate ranking quality
- NDCG = 0.0: Correct answer not in top K

**Advantage:** Penalizes correct answers appearing lower in the ranking.

## What Gets Tracked

### Pipeline-Level Parameters
- `query`: Search query
- `num_terms`: Number of candidate terms
- `llm_provider`: LLM provider (Groq/OpenAI)
- `llm_model`: Model name
- `prompt_variant`: Prompt version identifier
- `web_search_status`: Web search success status

### Pipeline-Level Metrics
- `total_time_seconds`: End-to-end latency
- `num_candidates`: Number of ranked candidates
- `top1_core_score`: Top candidate's core concept score
- `top1_spec_score`: Top candidate's specification score
- `mean_reciprocal_rank`: MRR across test cases (experiments only)
- `hit@5`: Hit rate at 5 (experiments only)
- `ndcg@5`: NDCG at 5 (experiments only)

### Component-Level Metrics (Nested Runs)
- `web_profiling_duration_seconds`: Web search component time
- `token_matching_duration_seconds`: Fuzzy matching component time
- `llm_ranking_duration_seconds`: LLM ranking component time

### Artifacts
- `pipeline_result.json`: Full pipeline output
- `prompts/*.txt`: Prompt templates used
- `*_output.json`: Component-specific outputs (if enabled)

## MLflow UI Features

Access at `http://localhost:5000` after running `mlflow ui`:

### Experiments View
- List all experiment runs
- Filter by parameters (prompt_variant, llm_model, etc.)
- Sort by metrics (MRR, latency, scores)

### Run Comparison
- Select multiple runs to compare side-by-side
- View parameter differences
- Plot metric trends
- Download comparison as CSV

### Run Details
- View all parameters and metrics
- Browse artifacts (JSON results, prompts)
- See nested run hierarchy (pipeline → components)
- Copy run ID for programmatic access

### Plots
- Parallel coordinates plot (parameters vs metrics)
- Scatter plot (any metric vs any other)
- Line plot (metric trends over time)

## Advanced Usage

### Custom Prompt Variants

1. Create prompt template file:
```bash
echo "Your custom prompt template" > evaluation/configs/prompts/my_variant_v1.txt
```

2. Update prompt in code (temporarily or via config)

3. Run experiment with variant name:
```bash
python evaluation/scripts/run_experiment.py --variant my_variant_v1
```

### Component-Level Tracking

To track individual components, add decorators:

```python
from evaluation.adapters.mlflow_adapter import tracker

@tracker.track_component("web_profiling", log_output=True)
async def web_generate_entity_profile(query, max_sites, schema, verbose):
    # Existing code unchanged
    ...
```

This creates nested runs under the main pipeline run.

### Logging Custom Metrics

Within a tracked function:

```python
import mlflow

# Log additional metrics
mlflow.log_metric("custom_metric", value)

# Log additional parameters
mlflow.log_param("custom_param", value)

# Log artifacts
mlflow.log_dict(data, "custom_artifact.json")
```

## Storage Location

All MLflow data is stored locally in:

```
backend-api/
├── mlruns/              # Experiment runs and artifacts
│   ├── 0/              # Default experiment
│   ├── 1/              # termnorm_prompt_optimization
│   └── ...
└── mlflow.db           # SQLite tracking database (metadata)
```

**Note:** You can add `mlruns/` to `.gitignore` or commit it for reproducibility.

## Troubleshooting

### MLflow UI won't start

```bash
# Check if another process is using port 5000
mlflow ui --port 5001

# Or specify backend store explicitly
mlflow ui --backend-store-uri file:./mlruns --port 5000
```

### Experiments not appearing

```bash
# Verify MLflow is using correct directory
cd backend-api
mlflow experiments list
```

### Import errors when running experiments

```bash
# Ensure you're in the correct directory and environment is activated
cd backend-api
.\venv\Scripts\activate  # Windows
source venv/bin/activate  # Linux/Mac

# Verify Python path
python -c "import sys; print(sys.path)"
```

### Tracking not working in production

1. Verify decorator is added to endpoint
2. Check that `evaluation/` directory exists in `backend-api/`
3. Ensure MLflow is installed: `pip list | grep mlflow`
4. Check for errors in server logs

## Best Practices

### For Development
1. Run experiments frequently during prompt development
2. Use descriptive variant names (e.g., `enhanced_core_concept_v2_1`)
3. Document prompt changes in MLflow parameters
4. Compare variants using MLflow UI before deploying

### For Production
1. Keep tracking enabled (minimal overhead)
2. Periodically review metrics in MLflow UI
3. Set up alerts for metric degradation (custom script)
4. Export important runs for archival

### For Test Datasets
1. Include diverse query types
2. Keep expected matches accurate and updated
3. Categorize test cases for targeted analysis
4. Extract real cases from production logs periodically

## Next Steps

1. **Extract production data**: Run `extract_test_cases.py` on your activity logs
2. **Run baseline experiment**: Test current prompt performance
3. **Create prompt variants**: Experiment with different prompt structures
4. **Compare results**: Use MLflow UI to identify best-performing variant
5. **Deploy winner**: Update production prompt and monitor metrics

## Additional Resources

- **MLflow Documentation**: https://mlflow.org/docs/latest/index.html
- **MLflow Tracking API**: https://mlflow.org/docs/latest/tracking.html
- **Information Retrieval Metrics**: https://en.wikipedia.org/wiki/Evaluation_measures_(information_retrieval)

## Support

For issues or questions:
1. Check MLflow UI logs
2. Review backend-api server logs
3. Consult CLAUDE.md for project architecture details
4. Check MLflow documentation for tracking API questions
