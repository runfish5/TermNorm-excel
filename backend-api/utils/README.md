# Utils - Production Utilities

Infrastructure for Langfuse-compatible logging, prompt versioning, and caching.

## Core Modules

**`langfuse_logger.py`** - Langfuse-compatible logging (~380 lines)
```python
# Low-level
create_trace(name, input, user_id, session_id, metadata, tags) -> trace_id
update_trace(trace_id, output, metadata)
get_trace(trace_id) -> Dict
create_observation(trace_id, type, name, input, output, model, metadata) -> obs_id
create_score(trace_id, name, value, data_type)
get_or_create_item(query, source_trace_id) -> item_id
set_ground_truth(item_id, target) -> bool
get_item_by_query(query) -> Dict

# High-level (use these)
log_pipeline(record, session_id) -> trace_id    # Full pipeline result
log_user_correction(source, target, method)      # UserChoice/DirectEdit
```

**`prompt_registry.py`** - Versioned prompts in `logs/prompts/`

**`cache_metadata.py`** - Tracks loaded data in `match_database.json`

**`standards_logger.py`** - Legacy MLflow logger (unused, kept for reference)

**`responses.py`**, **`utils.py`** - API helpers, terminal colors

## Design Principles

- Simple functions over classes
- Langfuse-compatible file structure
- Lazy index loading for fast startup
- No external dependencies (stdlib only)
