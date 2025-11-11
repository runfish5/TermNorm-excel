# Quick Start: MLflow Evaluation Framework

Simple guide to get started with the new MLflow evaluation components.

## What Was Added

New components for MLflow-compatible evaluation:

1. **Scorers** (`evaluation/scorers/`)
   - Standard IR metrics (MRR, Hit@K, NDCG@K)
   - LLM-as-judge for semantic evaluation

2. **Optimizer** (`evaluation/optimizers/`)
   - Simple prompt variant generator

3. **Demo Script** (`evaluation/scripts/mlflow_evaluation_demo.py`)
   - Complete evaluation workflow

## 5-Minute Test

### 1. Activate Environment

```bash
cd backend-api
.\venv\Scripts\activate  # Windows
```

### 2. Run Baseline Evaluation

```bash
python evaluation/scripts/mlflow_evaluation_demo.py --mode baseline
```

This runs the pipeline on 5 test cases and calculates:
- MRR (Mean Reciprocal Rank)
- Hit@5 (correct answer in top 5?)
- NDCG@5 (ranking quality)

### 3. View Results

```bash
mlflow ui --port 5000
```

Open: http://localhost:5000

You'll see:
- Run metrics (MRR, Hit@5, NDCG@5)
- Parameters (query, llm_provider, etc.)
- Artifacts (results CSV)

## Understanding the Components

### Scorers vs Metrics

**Metrics** (`evaluation/metrics/ranking_quality.py`):
- Core calculation functions
- Work with Python lists/dicts
- Example: `calculate_mrr(results)`

**Scorers** (`evaluation/scorers/standard_scorers.py`):
- MLflow-compatible wrappers
- Work with pandas DataFrames
- Example: `mrr_scorer(outputs, expectations)`

The scorers use the metrics internally but provide MLflow-compatible interface.

### How It Works

1. **Load test data**: Read `test_datasets.json`
2. **Run predictions**: Call `research_and_match` for each test case
3. **Calculate scores**: Apply scorers to predictions
4. **Log to MLflow**: Track metrics, parameters, artifacts

### Data Flow

```
test_datasets.json
    ↓
predict_fn() → research_and_match pipeline
    ↓
predictions DataFrame (ranked_candidates)
    ↓
scorers (mrr_scorer, hit_at_5_scorer, ndcg_at_5_scorer)
    ↓
scores DataFrame
    ↓
MLflow logging (metrics, artifacts)
```

## Comparing to MLflow Tutorial

### MLflow Tutorial Pattern

```python
def predict_fn(article) -> str:
    prompt = mlflow.genai.load_prompt(prompt_uri).template
    response = llm.invoke(prompt)
    return response.content

# Evaluate
results = mlflow.genai.evaluate(
    data=train_data,
    scorers=[exact_match],
    predict_fn=predict_fn
)
```

### TermNorm Adaptation

```python
async def predict_fn(row: pd.Series) -> dict:
    result = await research_and_match(
        request=MockRequest(),
        payload={"query": row["query"], "terms": row["terms"]}
    )
    return {"ranked_candidates": result["data"]["ranked_candidates"]}

# Evaluate (our wrapper)
predictions = run_predict_batch(test_data)
scores = mrr_scorer(predictions, expectations)
```

**Key Differences:**
- We use async pipeline → need event loop
- We return structured data (candidates list) not just text
- We have multiple scorers (MRR, Hit@K, NDCG@K) not just exact match

## Using Custom Scorers

### Example: Add Precision@K Scorer

```python
# evaluation/scorers/standard_scorers.py

def precision_at_k_scorer(k: int = 5):
    """Calculate precision at K"""
    def scorer(outputs: pd.DataFrame, expectations: pd.DataFrame) -> pd.Series:
        scores = []
        for idx in outputs.index:
            ranked = outputs.loc[idx, "ranked_candidates"]
            expected = expectations.loc[idx, "expected_match"]

            # Extract top K
            if isinstance(ranked[0], dict):
                top_k = [c.get("candidate", "") for c in ranked[:k]]
            else:
                top_k = ranked[:k]

            # Calculate precision (for single expected answer, same as Hit@K)
            precision = 1.0 if expected in top_k else 0.0
            scores.append(precision)

        return pd.Series(scores, index=outputs.index)

    scorer.__name__ = f"precision_at_{k}"
    return scorer

# Use it
precision_at_5 = precision_at_k_scorer(5)
scores = precision_at_5(predictions, expectations)
```

## Using the Optimizer

### Current Implementation

```bash
python evaluation/scripts/mlflow_evaluation_demo.py --mode optimize --variants 3
```

This:
1. Runs baseline evaluation
2. Generates 3 prompt variant configs
3. Shows suggested configurations

**Note:** The optimizer generates *configurations* but doesn't auto-apply them yet.

### Testing Variants Manually

1. Run optimizer to see configurations
2. Pick a variant (e.g., "core_focus": 80/20 weighting)
3. Modify prompt in `research_and_rank/call_llm_for_ranking.py`:
   ```python
   prompt = f"""TASK 1: Analyze profile and core concept (PRIMARY FACTOR - 80% WEIGHT)
   ...
   TASK 2: Score each candidate (0-5 scale)
   - Core concept score: semantic alignment (80% weight)
   - Specification score: detail matching (20% weight)
   ..."""
   ```
4. Run evaluation again:
   ```bash
   python evaluation/scripts/mlflow_evaluation_demo.py --mode baseline
   ```
5. Compare in MLflow UI

## Using LLM-as-Judge

```python
from evaluation.scorers import llm_judge_scorer

# Evaluate semantic correctness
scores = llm_judge_scorer(outputs, expectations)
```

**How it works:**
- Sends (query, predicted, expected) to LLM
- LLM judges semantic equivalence
- Returns 0.0-1.0 score
- Falls back to fuzzy matching if LLM fails

**When to use:**
- Test cases with semantic variations
- Queries where exact match is too strict
- Need human-like judgment

**When not to use:**
- Large evaluations (LLM costs)
- Exact match is sufficient
- Fast iteration needed

## Common Workflows

### Workflow 1: Baseline Testing

```bash
# 1. Run baseline
python evaluation/scripts/mlflow_evaluation_demo.py --mode baseline

# 2. View in MLflow UI
mlflow ui --port 5000

# 3. Check metrics
# - MRR > 0.7 = good
# - Hit@5 > 0.8 = good
# - NDCG@5 > 0.75 = good
```

### Workflow 2: Prompt Comparison

```bash
# 1. Run baseline
python evaluation/scripts/mlflow_evaluation_demo.py --mode baseline

# 2. Modify prompt in call_llm_for_ranking.py

# 3. Run variant (same command, new run)
python evaluation/scripts/mlflow_evaluation_demo.py --mode baseline

# 4. Compare in MLflow UI
# Select both runs → Compare
```

### Workflow 3: Custom Test Set

```bash
# 1. Create test file
cat > my_tests.json << EOF
[
  {
    "query": "my test query",
    "terms": ["candidate1", "candidate2"],
    "expected_match": "candidate1",
    "category": "custom"
  }
]
EOF

# 2. Run evaluation
python evaluation/scripts/mlflow_evaluation_demo.py \
  --mode baseline \
  --test-file my_tests.json
```

## Integration with Existing Code

The new components integrate seamlessly:

### Existing: `run_experiment.py`
- Batch runner
- Calculates MRR using `ranking_quality.py`
- Good for quick testing

### New: `mlflow_evaluation_demo.py`
- MLflow-compatible evaluation
- Uses pandas DataFrames
- Compatible with MLflow's `genai.evaluate()` pattern
- Good for systematic comparison

**Use both:**
- `run_experiment.py` for rapid iteration
- `mlflow_evaluation_demo.py` for formal evaluation

## Next Steps

1. **Run demo**: Test the framework with existing test cases
2. **Add test cases**: Expand `test_datasets.json` with more examples
3. **Test variants**: Manually modify prompts and compare
4. **Add scorers**: Implement custom metrics if needed
5. **Enhance optimizer**: Add dynamic prompt templating (future)

## Troubleshooting

### Import Errors

```bash
# Ensure correct directory
cd backend-api
python -c "import sys; print(sys.path)"

# Should see backend-api in path
```

### Async Errors

The pipeline is async, so we use `asyncio.run()` or event loops:

```python
# Correct
result = asyncio.run(predict_fn(row))

# Wrong
result = predict_fn(row)  # Returns coroutine, not result
```

### MLflow Not Finding Runs

```bash
# Check experiment
mlflow experiments list

# Start UI from correct directory
cd backend-api
mlflow ui --port 5000
```

## Summary

**What you can do now:**
- ✅ Run MLflow-compatible evaluations
- ✅ Use standard IR scorers (MRR, Hit@K, NDCG@K)
- ✅ Use LLM-as-judge for semantic evaluation
- ✅ Generate prompt variant suggestions
- ✅ Compare results in MLflow UI

**What requires manual work:**
- ⚠️ Applying prompt variants (modify code manually)
- ⚠️ Creating test datasets (use `extract_test_cases.py`)

**Future enhancements:**
- 🔄 Automatic prompt variant application
- 🔄 More sophisticated optimization (GEPA-like)
- 🔄 Additional scorers (precision, recall, F1)
