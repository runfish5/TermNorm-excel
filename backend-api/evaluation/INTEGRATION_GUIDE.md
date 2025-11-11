# MLflow Integration Guide

This guide shows how to integrate MLflow tracking into your TermNorm backend API.

## Quick Integration (Recommended)

The simplest way to enable tracking is using the decorator pattern on your API endpoint.

### Step 1: Import the Tracker

Add this import at the top of `backend-api/api/research_pipeline.py`:

```python
from evaluation.adapters.mlflow_adapter import tracker
```

### Step 2: Add Decorator to Endpoint

Add the `@tracker.track_pipeline()` decorator to your endpoint:

```python
@router.post("/research-and-match")
@tracker.track_pipeline("research_and_match")  # Add this line
async def research_and_match(request: Request, payload: Dict[str, Any] = Body(...)) -> Dict[str, Any]:
    """Research and match endpoint - existing docstring"""
    # All existing code stays exactly the same
    query = payload.get("query")
    terms = payload.get("terms", [])

    # ... rest of your existing code ...

    return response
```

That's it! Now every request will be automatically tracked.

### Step 3: Start Using It

1. **Run the server normally:**
   ```bash
   cd backend-api
   python -m uvicorn main:app --reload
   ```

2. **Make some requests** (through Excel add-in or directly)

3. **View tracked data:**
   ```bash
   cd backend-api
   mlflow ui --port 5000
   ```

   Open: http://localhost:5000

## What Gets Tracked Automatically

With just the decorator, MLflow tracks:

### Parameters
- `query`: The search query
- `num_terms`: Number of candidate terms
- `llm_provider`: Current LLM provider (Groq/OpenAI)
- `llm_model`: Model name
- `endpoint`: Always "research_and_match"
- `web_search_status`: Web search success/failure
- `top1_candidate`: Top ranked candidate

### Metrics
- `total_time_seconds`: End-to-end latency
- `status_code`: HTTP status (200 for success, 500 for error)
- `num_candidates`: Number of ranked candidates returned
- `top1_core_score`: Top candidate's core concept score
- `top1_spec_score`: Top candidate's specification score

### Artifacts
- `pipeline_result.json`: Full JSON response

### Error Tracking
If an error occurs:
- `error_type`: Exception class name
- `error_message`: Error message (truncated to 500 chars)

## Advanced: Component-Level Tracking

To track individual pipeline stages (web search, fuzzy matching, LLM ranking), add decorators to those functions.

### Track Web Profiling Component

In `backend-api/research_and_rank/web_generate_entity_profile.py`:

```python
from evaluation.adapters.mlflow_adapter import tracker

@tracker.track_component("web_profiling", log_output=False)
async def web_generate_entity_profile(
    query: str,
    max_sites: int,
    schema: str = "technical-sourcing-schema",
    verbose: bool = False
):
    # Existing code unchanged
    ...
```

This adds:
- `web_profiling_duration_seconds` metric
- Nested run under main pipeline run in MLflow UI

### Track LLM Ranking Component

In `backend-api/research_and_rank/call_llm_for_ranking.py`:

```python
from evaluation.adapters.mlflow_adapter import tracker

@tracker.track_component("llm_ranking", log_output=False)
async def call_llm_for_ranking(
    profile_info: str,
    entity_profile: str,
    match_results: list,
    query: str
):
    # Existing code unchanged
    ...
```

This adds:
- `llm_ranking_duration_seconds` metric
- Nested run under main pipeline run

### Track Fuzzy Matching Component

If you have an async fuzzy matching function:

```python
from evaluation.adapters.mlflow_adapter import tracker

@tracker.track_component("fuzzy_matching", log_output=False)
async def match_candidates(...):
    # Your code
    ...
```

## Viewing Results in MLflow UI

### 1. Start MLflow UI

```bash
cd backend-api
mlflow ui --port 5000
```

### 2. Navigate to Experiment

- Open http://localhost:5000
- Click on "termnorm_prompt_optimization" experiment
- See list of all runs

### 3. Filter and Sort

**Filter by parameters:**
- Click column headers to sort
- Use search box: `params.llm_model = "llama-4"`
- Filter by metrics: `metrics.total_time_seconds < 2.0`

**Useful filters:**
```
# Only successful runs
metrics.status_code = 200

# Fast queries
metrics.total_time_seconds < 1.0

# High quality results
metrics.top1_core_score > 0.8

# Specific LLM provider
params.llm_provider = "groq"
```

### 4. Compare Runs

- Select multiple runs (checkboxes)
- Click "Compare" button
- See side-by-side parameter and metric comparison
- View plots (scatter, parallel coordinates)

### 5. View Run Details

Click any run to see:
- All parameters and metrics
- Nested runs (components)
- Artifacts (pipeline_result.json)
- Run metadata (start time, duration, user)

## Programmatic Access

### Get Best Run

```python
from evaluation.adapters.mlflow_adapter import TermNormMLflowAdapter

tracker = TermNormMLflowAdapter()

# Get run with highest top1_core_score
best_run_id = tracker.get_best_run("top1_core_score", ascending=False)
print(f"Best run: {best_run_id}")

# Get fastest run
fastest_run_id = tracker.get_best_run("total_time_seconds", ascending=True)
print(f"Fastest run: {fastest_run_id}")
```

### Compare Multiple Runs

```python
from evaluation.adapters.mlflow_adapter import TermNormMLflowAdapter

tracker = TermNormMLflowAdapter()

run_ids = ["run_id_1", "run_id_2", "run_id_3"]
comparison = tracker.compare_runs(run_ids)

for run_data in comparison:
    print(f"\nRun: {run_data['run_name']}")
    print(f"  Core Score: {run_data['metrics'].get('top1_core_score', 'N/A')}")
    print(f"  Latency: {run_data['metrics'].get('total_time_seconds', 'N/A')}s")
```

### Get Experiment Summary

```python
from evaluation.adapters.mlflow_adapter import TermNormMLflowAdapter

tracker = TermNormMLflowAdapter()
summary = tracker.get_experiment_summary()

print(f"Total runs: {summary['total_runs']}")
print(f"Avg time: {summary['avg_total_time_seconds']:.2f}s")
```

## Custom Metrics and Parameters

You can log additional metrics or parameters inside tracked functions:

```python
import mlflow

@router.post("/research-and-match")
@tracker.track_pipeline("research_and_match")
async def research_and_match(request: Request, payload: Dict[str, Any] = Body(...)):
    # Your existing code...

    # Log custom metric
    if some_condition:
        mlflow.log_metric("custom_metric", value)

    # Log custom parameter
    mlflow.log_param("custom_config", config_value)

    # Log custom artifact
    mlflow.log_dict({"analysis": data}, "custom_analysis.json")

    return response
```

## Disabling Tracking Temporarily

To disable tracking without removing decorators:

### Option 1: Environment Variable

```bash
# Set in .env or environment
export MLFLOW_TRACKING_URI=/dev/null
```

### Option 2: Comment Out Decorator

```python
# @tracker.track_pipeline("research_and_match")  # Temporarily disabled
async def research_and_match(...):
    ...
```

### Option 3: Conditional Tracking

```python
import os

if os.getenv("ENABLE_MLFLOW", "true").lower() == "true":
    @tracker.track_pipeline("research_and_match")
    async def research_and_match(...):
        ...
else:
    async def research_and_match(...):
        ...
```

## Performance Impact

MLflow tracking has minimal overhead:

- **Without component tracking**: ~10-20ms per request
- **With component tracking**: ~30-50ms per request
- **Storage**: ~1-5KB per run (JSON artifacts can be larger)

For production use:
- Tracking overhead is negligible compared to LLM/web search latency
- MLflow uses async I/O for artifact storage
- No external network calls (fully local)

## Storage Management

### Location

All data stored in:
```
backend-api/
├── mlruns/          # Experiment data and artifacts
│   └── 1/           # termnorm_prompt_optimization experiment
└── mlflow.db        # Metadata database (SQLite)
```

### Size Management

```bash
# Check storage size
du -sh backend-api/mlruns

# Clean old runs (manual)
rm -rf backend-api/mlruns/1/*
# Or use MLflow UI to delete specific runs

# Archive important runs
cp -r backend-api/mlruns/1/abc123 ./archived_runs/
```

### Git Strategy

**Option 1: Ignore all runs** (recommended for development)
- Already in `.gitignore`: `backend-api/mlruns/`
- Keeps repository clean

**Option 2: Commit important runs**
- Remove `mlruns/` from `.gitignore`
- Commit baseline/benchmark runs for team reference

## Troubleshooting

### "No active run" warning

This is normal when calling tracked functions outside of a run context. The decorator handles this automatically.

### MLflow UI shows empty experiment

```bash
# Verify experiment exists
cd backend-api
mlflow experiments list

# Check tracking URI
python -c "import mlflow; print(mlflow.get_tracking_uri())"

# Should output: file:./mlruns
```

### Tracking not working

1. **Check import:**
   ```python
   from evaluation.adapters.mlflow_adapter import tracker
   ```

2. **Check decorator is applied:**
   ```python
   @tracker.track_pipeline("research_and_match")  # This line must be present
   ```

3. **Check MLflow is installed:**
   ```bash
   pip list | grep mlflow
   ```

4. **Check for errors in server logs**

### Slow startup after many runs

MLflow UI can be slow with 1000+ runs:

```bash
# Limit runs displayed
mlflow ui --port 5000 --default-artifact-root ./mlruns --max-results 100
```

## Next Steps

1. ✅ Add `@tracker.track_pipeline()` decorator to endpoint
2. ✅ Make some test requests
3. ✅ Open MLflow UI and explore
4. ✅ Run experiments: `python evaluation/scripts/run_experiment.py`
5. ✅ Compare prompt variants in UI
6. ✅ Extract real test cases from logs

## More Information

- See `evaluation/README.md` for full framework documentation
- See `evaluation/scripts/run_experiment.py` for experiment running
- See MLflow docs: https://mlflow.org/docs/latest/tracking.html
