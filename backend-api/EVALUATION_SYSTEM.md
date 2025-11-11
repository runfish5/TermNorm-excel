# Research Pipeline Evaluation System - Implementation Summary

## Overview

Comprehensive evaluation framework for the TermNorm research pipeline, enabling systematic testing and version control of LLM prompts used in entity profiling and candidate ranking stages.

## Architecture

### Components

1. **Prompt Versioning System** (`prompts/`)
   - Centralized prompt management with metadata
   - Version-controlled JSON files
   - Automatic prompt loading and caching
   - Backwards-compatible with existing code

2. **Evaluation Metrics** (`evaluation/metrics/`)
   - Entity profiling: completeness, accuracy, coverage, richness
   - Candidate ranking: MRR, Precision@K, NDCG, correlation
   - Quantitative measurements for objective comparison

3. **Test Datasets** (`evaluation/datasets/`)
   - Entity profiling: 5 diverse test cases
   - Candidate ranking: 5 test cases with expected rankings
   - JSONL format for easy expansion

4. **Evaluation Runner** (`evaluation/evaluate_prompts.py`)
   - Automated testing framework
   - Multi-version comparison
   - Report generation and analysis

## Key Features

### 1. Versioned Prompt Management

```
prompts/
├── prompt_loader.py                 # Loader with caching
├── entity_profiling/
│   └── v1.0.0.json                 # Production baseline
└── candidate_ranking/
    └── v1.0.0.json                 # Production baseline
```

**Benefits:**
- Track prompt evolution over time
- A/B test different approaches
- Roll back to previous versions
- Document design decisions

### 2. Comprehensive Metrics

**Entity Profiling Metrics:**
```python
{
  'completeness': 0.85,              # 85% of schema fields populated
  'core_concept_accuracy': 0.80,     # 80% exact matches
  'synonym_coverage': 0.75,          # 75% of expected synonyms found
  'array_richness': 6.5              # Average 6.5 items per array
}
```

**Candidate Ranking Metrics:**
```python
{
  'mrr': 0.85,                       # First result usually correct
  'precision_at_3': 0.67,            # 2 of 3 top results relevant
  'ndcg_at_5': 0.82,                 # Good ranking quality
  'rank_correlation': 0.75           # 75% alignment with expected order
}
```

### 3. Automated Evaluation

```bash
# Single version evaluation
python evaluation/evaluate_prompts.py --stage entity_profiling

# Multi-version comparison
python evaluation/evaluate_prompts.py --versions 1.0.0 1.1.0 1.2.0

# Compare all versions
python evaluation/evaluate_prompts.py --compare
```

### 4. Pipeline Integration

Minimal code changes required - versioning is opt-in:

```python
# Default: uses latest version (backwards compatible)
profile, _ = await web_generate_entity_profile(query, schema=ENTITY_SCHEMA)

# Explicit version specification
profile, _ = await web_generate_entity_profile(
    query,
    schema=ENTITY_SCHEMA,
    prompt_version="1.1.0"
)
```

## File Structure

```
backend-api/
├── prompts/                         # NEW: Prompt versioning
│   ├── prompt_loader.py            # Prompt loading utility
│   ├── entity_profiling/
│   │   └── v1.0.0.json            # Baseline entity profiling prompt
│   └── candidate_ranking/
│       └── v1.0.0.json            # Baseline ranking prompt
│
├── evaluation/                      # NEW: Evaluation framework
│   ├── README.md                   # Full documentation
│   ├── QUICKSTART.md               # 5-minute getting started
│   ├── evaluate_prompts.py         # Main evaluation runner (executable)
│   ├── datasets/
│   │   ├── entity_profiling_test_cases.jsonl
│   │   └── candidate_ranking_test_cases.jsonl
│   ├── metrics/
│   │   ├── entity_profiling_metrics.py
│   │   └── candidate_ranking_metrics.py
│   └── results/                    # Generated reports (gitignored)
│
├── research_and_rank/              # MODIFIED: Added versioning support
│   ├── web_generate_entity_profile.py  # Added prompt_version parameter
│   └── call_llm_for_ranking.py         # Added prompt_version parameter
│
└── EVALUATION_SYSTEM.md            # This file
```

## Usage Examples

### Example 1: Baseline Evaluation

```bash
cd backend-api
python evaluation/evaluate_prompts.py
```

**Output:**
```
✓ Loaded 5 test cases for entity_profiling
📊 Evaluating entity profiling prompt v1.0.0...

============================================================
  ENTITY PROFILING EVALUATION SUMMARY
============================================================
Version: v1.0.0
Test Cases: 5

Aggregate Metrics:
  Completeness: 85.0%
  Core Concept Accuracy: 80.0%
  Synonym Coverage: 75.0%
  Array Richness: 6.5 items/array
============================================================
```

### Example 2: Create and Test New Version

**Create v1.1.0:**
```bash
cp prompts/entity_profiling/v1.0.0.json prompts/entity_profiling/v1.1.0.json
# Edit v1.1.0.json with improvements
```

**Test both versions:**
```bash
python evaluation/evaluate_prompts.py --stage entity_profiling --versions 1.0.0 1.1.0
```

**Compare results:**
```
🏆 Best Version: v1.1.0
📊 Best version v1.1.0 shows 12.5% improvement over v1.0.0

Ranking:
  1. v1.1.0: Entity Profiling - Enhanced Synonyms (Score: 0.892)
  2. v1.0.0: Entity Profiling - Baseline (Score: 0.792)
```

### Example 3: Add Custom Test Case

**Entity Profiling Test:**
```json
{
  "query": "6061 aluminum alloy",
  "expected_profile": {
    "core_concept": "alloy",
    "synonyms": ["6061 aluminum", "Al 6061", "AA 6061"],
    "composition": ["aluminum", "magnesium", "silicon"],
    "applications": ["aircraft", "marine", "structural"]
  },
  "notes": "Common aerospace alloy with well-defined properties"
}
```

**Candidate Ranking Test:**
```json
{
  "query": "powder coating aluminum",
  "entity_profile": {
    "core_concept": "coating",
    "process_type": ["surface treatment"]
  },
  "candidates": ["Powder Coating", "Aluminum Sheet", "Anodizing"],
  "expected_top_3": ["Powder Coating", "Anodizing", "Aluminum Sheet"],
  "expected_core_scores": {
    "Powder Coating": [4.5, 5.0],
    "Anodizing": [3.5, 4.5],
    "Aluminum Sheet": [0.0, 2.0]
  },
  "notes": "Process vs material - sheet should score very low"
}
```

## Metrics Reference

### Entity Profiling Metrics

| Metric | Range | Target | Description |
|--------|-------|--------|-------------|
| Completeness | 0.0-1.0 | >0.85 | Fraction of schema fields populated |
| Core Concept Accuracy | 0.0-1.0 | >0.80 | Exact match rate for core concept |
| Synonym Coverage | 0.0-1.0 | >0.75 | Fraction of expected synonyms found |
| Array Richness | 0-∞ | >6.0 | Average items per array field |
| Spelling Variants | count | >0 | Number of US/GB variant pairs |

### Candidate Ranking Metrics

| Metric | Range | Target | Description |
|--------|-------|--------|-------------|
| MRR | 0.0-1.0 | >0.85 | Mean reciprocal rank (1/position of first match) |
| Precision@1 | 0.0-1.0 | >0.80 | Top 1 result is relevant |
| Precision@3 | 0.0-1.0 | >0.67 | 2+ of top 3 are relevant |
| Precision@5 | 0.0-1.0 | >0.60 | 3+ of top 5 are relevant |
| Recall@5 | 0.0-1.0 | >0.80 | Fraction of relevant results in top 5 |
| NDCG@5 | 0.0-1.0 | >0.80 | Normalized discounted cumulative gain |
| Rank Correlation | -1.0-1.0 | >0.70 | Spearman's rho with expected order |
| Score Accuracy | 0.0-1.0 | >0.75 | Core scores within expected ranges |

## Development Workflow

```
┌─────────────────────────────────────────────────────────┐
│  1. Baseline Evaluation (v1.0.0)                       │
│     - Run evaluation on current production prompt      │
│     - Document baseline metrics                        │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  2. Identify Issue                                      │
│     - Low synonym coverage? Missing technical terms?   │
│     - Wrong core concepts? Poor ranking?               │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  3. Create Experimental Version (v1.1.0)               │
│     - Copy v1.0.0 → v1.1.0                            │
│     - Modify prompt with targeted improvements         │
│     - Set status: "experimental"                       │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  4. Evaluate New Version                                │
│     - Run: --versions 1.0.0 1.1.0                      │
│     - Compare metrics side-by-side                     │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  5. Analyze Results                                     │
│     - Did metrics improve overall?                     │
│     - Any regressions on specific test cases?          │
│     - Review detailed results for insights             │
└────────────────┬────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
   [Improved?]        [Worse?]
        │                 │
        │                 └──> Iterate (back to step 3)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│  6. Promote to Production                               │
│     - Update status: "production"                       │
│     - Update pipeline to use v1.1.0                    │
│     - Archive v1.0.0 as reference                      │
└─────────────────────────────────────────────────────────┘
```

## Integration Points

### 1. Research Pipeline (`api/research_pipeline.py`)

Current: Stateless pipeline creates matcher on-the-fly
Change: None required - versioning is transparent

### 2. Entity Profiling (`research_and_rank/web_generate_entity_profile.py`)

Added: `prompt_version="latest"` parameter
Fallback: Uses hardcoded prompt if version loading fails

### 3. Candidate Ranking (`research_and_rank/call_llm_for_ranking.py`)

Added: `prompt_version="latest"` parameter
Fallback: Uses hardcoded prompt if version loading fails

## Benefits

### For Development
- **Systematic Testing**: Quantitative metrics replace subjective assessment
- **Version Control**: Track prompt evolution and design decisions
- **Rapid Iteration**: Quick feedback on prompt changes
- **Regression Prevention**: Catch performance drops early

### For Production
- **Quality Assurance**: Only deploy tested, measured improvements
- **Rollback Safety**: Revert to previous version if issues arise
- **Performance Tracking**: Monitor metrics over time
- **Documentation**: Versioned prompts serve as historical record

### For Research
- **A/B Testing**: Compare different prompt strategies objectively
- **Ablation Studies**: Test impact of specific prompt components
- **Benchmarking**: Establish baseline for future improvements
- **Knowledge Transfer**: Share versioned prompts with team

## Maintenance

### Adding Test Cases

1. Identify edge cases from production logs
2. Add to appropriate `.jsonl` file
3. Re-run evaluation to measure impact
4. Keep test suite focused (aim for 5-10 cases per stage)

### Updating Metrics

1. Add new metric to appropriate metrics module
2. Update `evaluate_all()` method to include it
3. Update documentation and target thresholds
4. Re-run evaluation to establish baselines

### Managing Versions

- **Keep**: Production versions + last 2-3 experimental versions
- **Archive**: Old experimental versions to `prompts/archive/`
- **Document**: Update CHANGELOG when promoting to production

## Future Enhancements

### Potential Additions

1. **Live Production Testing**
   - A/B test prompts with real user queries
   - Collect feedback on result quality
   - Auto-promote based on user satisfaction

2. **Automated Regression Testing**
   - CI/CD integration to test on every commit
   - Block deployment if metrics regress
   - Automated notification of failures

3. **Extended Metrics**
   - Latency measurements (tokens/second)
   - Cost analysis (API calls, tokens used)
   - Diversity metrics (result uniqueness)

4. **Visual Analysis Tools**
   - Web dashboard for metric visualization
   - Trend analysis over time
   - Heat maps for test case performance

5. **Expanded Test Coverage**
   - Cross-domain queries (medical, legal, etc.)
   - Multilingual test cases
   - Adversarial examples (edge cases)

## Getting Started

### Quick Start (5 minutes)

```bash
cd backend-api

# 1. Run baseline evaluation
python evaluation/evaluate_prompts.py

# 2. Review results in evaluation/results/

# 3. Create new version
cp prompts/entity_profiling/v1.0.0.json prompts/entity_profiling/v1.1.0.json

# 4. Edit v1.1.0.json with improvements

# 5. Compare versions
python evaluation/evaluate_prompts.py --versions 1.0.0 1.1.0

# 6. Promote if improved
# Update status in v1.1.0.json to "production"
```

### Documentation

- **Quick Start**: `evaluation/QUICKSTART.md`
- **Full Documentation**: `evaluation/README.md`
- **This Summary**: `EVALUATION_SYSTEM.md`

## Summary

The evaluation system provides a **complete framework for systematic prompt engineering**:

✅ **Version Control**: Track and manage prompt evolution
✅ **Quantitative Metrics**: Measure performance objectively
✅ **Automated Testing**: Quick feedback on changes
✅ **Production Ready**: Minimal integration, backwards compatible
✅ **Extensible**: Easy to add new metrics and test cases

Start evaluating your prompts today with:
```bash
python evaluation/evaluate_prompts.py
```

---

**Implementation Date**: 2025-01-15
**Version**: 1.0.0
**Status**: Production Ready
**Maintained By**: TermNorm Development Team
