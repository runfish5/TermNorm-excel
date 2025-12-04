# Utils - Production Utilities

Infrastructure for experiment tracking, prompt versioning, and standards-compliant logging.

## Core Modules

**`prompt_registry.py`**
- Versioned prompts (MLflow format) in `logs/prompts/` (v1, v2, ...)
- Usage: `get_prompt_registry().render_prompt(family="entity_profiling", version=1, **vars)`

**`live_experiment_logger.py`**
- Real-time production logging to experiments structure
- Singleton with automatic daily run management
- Dual logging: `activity.jsonl` (legacy) + experiments (new)

**`cache_metadata.py`**
- Tracks loaded experiments/runs in `match_database.json`
- Staleness detection for smart cache rebuilds

**`standards_logger.py`**
- MLflow-compatible experiment/run/trace writer (no MLflow dependency)
- Generates: `meta.yaml`, `params.json`, `tags.json`, `metrics.json`, traces

**`responses.py`**, **`utils.py`**
- API helpers, terminal colors, utilities

## Design

Minimal dependencies (stdlib + pyyaml), standards-compliant (MLflow/Langfuse/DSPy/GitHub Models), git-friendly (structure versioned, data ignored)
