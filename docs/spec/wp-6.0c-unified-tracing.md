# WP 6.0c: Unified Tracing

> Parent: [Pipeline Composability Overview](README.md)

**Goal:** One Langfuse trace per query, all pipeline steps as observations.

---

## Current State

Frontend cache/fuzzy matches are logged via `POST /activities/matches` → fire-and-forget `logMatch()`. Backend creates **separate traces** per method:

- `log_cache_match()` — creates its own trace + cache_lookup observation
- `log_fuzzy_match()` — creates its own trace + fuzzy_matching observation
- `log_pipeline()` — creates its own trace + web_search/entity_profiling/token_matching/llm_ranking observations

**Problem:** No unified view. A query that goes cache miss → fuzzy miss → LLM creates 3 separate traces. We can't see the full pipeline flow.

## Target

One trace per query. Frontend creates the trace, reports its steps, then passes `trace_id` to backend.

```
Frontend:
  1. POST /pipeline/trace {query} → trace_id
  2. Run cache lookup locally
  3. POST /pipeline/steps {trace_id, "cache_lookup", result}
  4. If cache hit → done
  5. Run fuzzy locally
  6. POST /pipeline/steps {trace_id, "fuzzy_matching", result}
  7. If fuzzy hit → done
  8. POST /matches {query, trace_id} → backend continues same trace
```

---

## 3A: Trace Lifecycle Endpoints

### Add to `backend-api/api/pipeline.py`

- `POST /pipeline/trace` — create trace, return `trace_id`
  - Input: `{ query, session_id?, user_id? }`
  - Returns: `{ "status": "ok", "data": { "trace_id": "..." } }`

- `POST /pipeline/steps` — report frontend step as observation on existing trace
  - Input: `{ trace_id, step_name, result, latency_ms }`
  - If result has `target` + `method`: also finalizes trace (score + update)

---

## 3B: Backend Accepts trace_id

### Modify `backend-api/utils/langfuse_logger.py` — `log_pipeline()`

Add optional `trace_id` parameter:
- When provided: skip `create_trace()`, attach observations to existing trace
- When absent: create new trace (backward compatible)

### Modify `backend-api/api/research_pipeline.py` — `/matches`

- Accept optional `trace_id` in payload
- Pass to `log_pipeline(..., trace_id=trace_id)`

---

## 3C: Frontend Trace Integration

### Modify `src/utils/api-fetch.js`

Add helpers:
- `createPipelineTrace(query, headers)` — `POST /pipeline/trace`
- `reportPipelineStep(traceId, stepName, result, latencyMs, headers)` — fire-and-forget `POST /pipeline/steps`

### Modify `src/services/normalizer.js` — `processTermNormalization()`

- Create trace at start
- Report `cache_lookup` step (hit or miss) with latency
- Report `fuzzy_matching` step (hit or miss) with latency
- Pass `trace_id` to `findTokenMatch()` → forwarded to `POST /matches`

---

## Backward Compatibility

- `/matches` without `trace_id` → creates its own trace (existing behavior)
- `/matches` with `trace_id` → attaches observations to existing trace
- Old frontend versions continue to work
- `log_cache_match()` / `log_fuzzy_match()` become unused but stay (deprecated comment)

## Migration Note

After unified tracing is deployed and verified:
- The old `logMatch()` fire-and-forget calls in `processTermNormalization()` can be removed
- `log_cache_match()` and `log_fuzzy_match()` in `langfuse_logger.py` can be deprecated

---

## Verification

1. Process a term that triggers LLM research (cache miss + fuzzy miss)
   - Check `logs/langfuse/traces/` — should see **one** trace file
   - Check `logs/langfuse/observations/{trace_id}/` — should see observations for all 6 steps
2. Process a term that hits cache — one trace with only `cache_lookup` observation
3. Process a term that hits fuzzy — one trace with `cache_lookup` (miss) + `fuzzy_matching` (hit)
4. `/matches` with `trace_id` param: observations attached to existing trace
5. `/matches` without `trace_id`: creates its own trace (backward compat)
