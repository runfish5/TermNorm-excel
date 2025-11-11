# Research Pipeline Evaluation System

Complete evaluation framework for testing and comparing different prompt versions in the TermNorm research pipeline.

## 📁 Structure

```
evaluation/
├── README.md                          # This file
├── evaluate_prompts.py                # Main evaluation runner script
├── datasets/                          # Test case datasets
│   ├── entity_profiling_test_cases.jsonl
│   └── candidate_ranking_test_cases.jsonl
├── metrics/                           # Evaluation metrics modules
│   ├── entity_profiling_metrics.py   # Completeness, accuracy, coverage
│   └── candidate_ranking_metrics.py  # MRR, Precision@K, NDCG, rank correlation
└── results/                           # Generated evaluation reports (gitignored)
```

## 🎯 Features

### 1. Prompt Versioning System

Centralized prompt management in `/backend-api/prompts/`:

```
prompts/
├── prompt_loader.py                   # Prompt loading and caching
├── entity_profiling/
│   └── v1.0.0.json                   # Versioned prompts with metadata
└── candidate_ranking/
    └── v1.0.0.json
```

**Prompt Version Format:**
```json
{
  "version": "1.0.0",
  "name": "Descriptive Name",
  "description": "What changed in this version",
  "created_date": "2025-01-15",
  "author": "Team Member",
  "status": "production|experimental|deprecated",
  "prompt_template": "Actual prompt with {placeholders}",
  "parameters": {
    "param_name": "description"
  },
  "llm_config": {
    "temperature": 0.3,
    "max_tokens": 1800
  },
  "notes": ["Design decisions", "Known issues"]
}
```

### 2. Evaluation Metrics

#### Entity Profiling Metrics
- **Schema Completeness**: % of fields populated (0.0-1.0)
- **Core Concept Accuracy**: Exact match + similarity score
- **Synonym Coverage**: % of expected synonyms found
- **Spelling Variants**: US/GB pair detection
- **Array Richness**: Average items per array field

#### Candidate Ranking Metrics
- **MRR (Mean Reciprocal Rank)**: First relevant result position
- **Precision@K**: Fraction of top K results that are relevant
- **Recall@K**: Fraction of relevant results in top K
- **NDCG@K**: Normalized Discounted Cumulative Gain
- **Score Accuracy**: Core concept scores within expected ranges
- **Rank Correlation**: Spearman's rho with expected ordering

### 3. Test Datasets

**Entity Profiling Test Cases** (`entity_profiling_test_cases.jsonl`):
```jsonl
{
  "query": "stainless steel 304",
  "expected_profile": {
    "core_concept": "alloy",
    "synonyms": ["SS304", "304 stainless", ...],
    "material_properties": [...],
    ...
  },
  "notes": "Common material with well-known properties"
}
```

**Candidate Ranking Test Cases** (`candidate_ranking_test_cases.jsonl`):
```jsonl
{
  "query": "laser cutting carbon steel",
  "entity_profile": {"core_concept": "cutting", ...},
  "candidates": ["Laser Cutting", "Plasma Cutting", ...],
  "expected_top_3": ["Laser Cutting", ...],
  "expected_core_scores": {
    "Laser Cutting": [4.5, 5.0],
    "Plasma Cutting": [3.5, 4.5]
  },
  "notes": "Process core concept - material alone should score low"
}
```

## 🚀 Usage

### Basic Evaluation

Evaluate latest prompt versions:
```bash
cd backend-api
python evaluation/evaluate_prompts.py
```

### Stage-Specific Evaluation

Evaluate only entity profiling:
```bash
python evaluation/evaluate_prompts.py --stage entity_profiling
```

Evaluate only candidate ranking:
```bash
python evaluation/evaluate_prompts.py --stage candidate_ranking
```

### Version Comparison

Compare specific versions:
```bash
python evaluation/evaluate_prompts.py --stage entity_profiling --versions 1.0.0 1.1.0 1.2.0
```

Compare all available versions:
```bash
python evaluation/evaluate_prompts.py --compare
```

### Custom Output Directory

```bash
python evaluation/evaluate_prompts.py --output /path/to/results
```

## 📊 Interpreting Results

### Entity Profiling Report
```json
{
  "version": "1.0.0",
  "prompt_name": "Entity Profiling - Comprehensive Technical Database API",
  "test_case_count": 5,
  "aggregate_metrics": {
    "completeness": {
      "average": 0.85,
      "percentage": "85.0%"
    },
    "core_concept_accuracy": {
      "exact_match_rate": 0.80,
      "average_similarity": 0.90
    },
    "synonym_coverage": {
      "average": 0.75,
      "percentage": "75.0%"
    }
  }
}
```

**Key Indicators:**
- ✅ **Completeness > 0.80**: Good schema field population
- ✅ **Core Concept Accuracy > 0.75**: Reliable concept identification
- ✅ **Synonym Coverage > 0.70**: Comprehensive term extraction

### Candidate Ranking Report
```json
{
  "aggregate_metrics": {
    "mrr": 0.85,
    "precision": {
      "p@1": 0.80,
      "p@3": 0.67,
      "p@5": 0.60
    },
    "ndcg_at_5": 0.82,
    "rank_correlation": 0.75
  }
}
```

**Key Indicators:**
- ✅ **MRR > 0.80**: First result is usually correct
- ✅ **P@3 > 0.60**: Top 3 contain relevant results
- ✅ **NDCG@5 > 0.75**: Good ranking quality
- ✅ **Rank Correlation > 0.70**: Ordering aligns with expectations

## 🔄 Creating New Prompt Versions

### 1. Create New Version File

Copy existing version and increment:
```bash
cp prompts/entity_profiling/v1.0.0.json prompts/entity_profiling/v1.1.0.json
```

### 2. Update Version Metadata

```json
{
  "version": "1.1.0",
  "name": "Entity Profiling - Enhanced Synonym Extraction",
  "description": "Added explicit instructions for technical abbreviations",
  "created_date": "2025-01-20",
  "status": "experimental",
  ...
}
```

### 3. Modify Prompt Template

Edit the `prompt_template` field with your changes.

### 4. Test New Version

```bash
python evaluation/evaluate_prompts.py --stage entity_profiling --versions 1.0.0 1.1.0
```

### 5. Promote to Production

If metrics improve, update status:
```json
{
  "status": "production"
}
```

## 🧪 Adding Test Cases

### Entity Profiling Test Case

Add to `datasets/entity_profiling_test_cases.jsonl`:
```json
{
  "query": "your test query",
  "expected_profile": {
    "core_concept": "expected concept",
    "synonyms": ["expected", "terms"],
    "material_properties": ["expected", "properties"]
  },
  "notes": "Why this test case is important"
}
```

### Candidate Ranking Test Case

Add to `datasets/candidate_ranking_test_cases.jsonl`:
```json
{
  "query": "your test query",
  "entity_profile": {
    "core_concept": "concept",
    "synonyms": ["terms"]
  },
  "candidates": ["Option A", "Option B", "Option C"],
  "expected_top_3": ["Option A", "Option C", "Option B"],
  "expected_core_scores": {
    "Option A": [4.5, 5.0],
    "Option B": [3.0, 4.0],
    "Option C": [4.0, 4.8]
  },
  "notes": "What this tests"
}
```

## 🔌 Integration with Pipeline

The pipeline code automatically uses versioned prompts:

```python
# Default: uses latest version
profile, debug = await web_generate_entity_profile(
    query="stainless steel",
    schema=ENTITY_SCHEMA
)

# Specify version
profile, debug = await web_generate_entity_profile(
    query="stainless steel",
    schema=ENTITY_SCHEMA,
    prompt_version="1.1.0"  # Use specific version
)
```

Same for ranking:
```python
result, debug = await call_llm_for_ranking(
    profile_info, entity_profile, candidates, query,
    prompt_version="1.2.0"  # Optional version specification
)
```

## 📝 Best Practices

### Prompt Development Workflow

1. **Baseline**: Start with current production version (v1.0.0)
2. **Hypothesis**: Identify specific issue or improvement goal
3. **Create**: New experimental version with targeted changes
4. **Evaluate**: Run evaluation suite comparing old vs new
5. **Analyze**: Review metrics and detailed results
6. **Iterate**: Refine based on failures and edge cases
7. **Promote**: Update status to "production" when ready

### Test Case Design

- **Diversity**: Cover different entity types (materials, processes, products)
- **Edge Cases**: Test ambiguous queries, multi-word concepts, abbreviations
- **Negative Cases**: Include examples where ranking should penalize wrong categories
- **Real-World**: Use actual queries from production logs
- **Documentation**: Always include `notes` explaining test rationale

### Version Naming

Follow semantic versioning:
- **Major (x.0.0)**: Breaking changes, complete prompt rewrites
- **Minor (1.x.0)**: New instructions, significant modifications
- **Patch (1.0.x)**: Bug fixes, clarifications, small tweaks

## 🐛 Troubleshooting

### Prompt Not Loading

```python
# Check available versions
from prompts.prompt_loader import get_prompt_loader
loader = get_prompt_loader()
versions = loader.list_versions('entity_profiling')
print(versions)
```

### Evaluation Errors

```bash
# Check test case syntax
python -m json.tool datasets/entity_profiling_test_cases.jsonl

# Run with verbose logging
python evaluation/evaluate_prompts.py --stage entity_profiling --verbose
```

### Low Metrics

- **Low Completeness**: Prompt may be too restrictive, increase max_tokens
- **Low Synonym Coverage**: Add explicit synonym extraction instructions
- **Low MRR**: Core concept identification may be incorrect
- **Low Score Accuracy**: Review scoring rubric and category definitions

## 📚 References

- **Entity Profile Schema**: `backend-api/research_and_rank/entity_profile_schema.json`
- **Prompt Loader API**: `backend-api/prompts/prompt_loader.py`
- **Pipeline Integration**: `backend-api/api/research_pipeline.py`

## 🤝 Contributing

When adding new metrics or test cases:

1. Document the metric calculation method
2. Add type hints and docstrings
3. Include example test cases
4. Update this README with usage examples
5. Run full evaluation suite before committing

---

**Last Updated**: 2025-01-15
**Maintained By**: TermNorm Development Team
