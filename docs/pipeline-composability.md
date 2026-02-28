# TermNorm Pipeline Composability — Task Doc

**Date:** 2026-02-28
**Parent spec:** [PromptPotter M6 spec](../../../Desktop/PromptPotter/prompt-potter-optimizer/docs/specs/m6-workflow-migration.md)
**Scope:** 3 work packages (WP 6.0a, 6.0b, 6.0c) — all in this repo

---

## Goal

Make the full TermNorm pipeline (Cache → Fuzzy → LLM) observable and configurable via a JSON pipeline contract. Three steps:

1. **Simplify** — reduce fuzzy matcher from 3 thresholds + bidirectional search to 1 threshold + single pass
2. **Expose** — `GET /pipeline` returns the complete 6-step pipeline config (frontend + backend steps)
3. **Unify tracing** — one Langfuse trace per query with all steps as observations (instead of separate traces per method)

---

## WP 6.0a: Simplify Fuzzy Matcher + Confidence Constants (Wave 0)

**Goal:** Remove overparameterization before codifying config in pipeline JSON.

### Current state

`src/matchers/matchers.js` — `findFuzzyMatch()` does forward search at 0.7, then reverse search at 0.5:

```js
// Current (line 94)
export function findFuzzyMatch(value, forward, reverse,
    forwardThreshold = FUZZY_THRESHOLDS.FORWARD,
    reverseThreshold = FUZZY_THRESHOLDS.REVERSE) {
  // 1. Forward search: find best match in forward mappings at 0.7
  const fwd = findBestMatch(normalized, forward, forwardThreshold);
  if (fwd) return { ... direction: 'forward' };

  // 2. Reverse search: find best match in reverse mappings at 0.5 (looser)
  const rev = findBestMatch(normalized, reverse, reverseThreshold);
  if (rev) return { ... direction: 'reverse' };

  return null;
}
```

`src/config/config.js` — three fuzzy thresholds:

```js
export const FUZZY_THRESHOLDS = {
  FORWARD: 0.7,      // Minimum similarity for source→target matching
  REVERSE: 0.5,      // Minimum similarity for target→source verification
  DEFAULT: 0.6,      // Default threshold for general fuzzy operations
};
```

`src/services/normalizer.js` — wrapper that passes both thresholds:

```js
export function findFuzzyMatch(value, forward, reverse) {
  return findFuzzyMatchDomain(value, forward, reverse,
    FUZZY_THRESHOLDS.FORWARD, FUZZY_THRESHOLDS.REVERSE);
}
```

### Target

Single-direction search, single threshold. Search all mapping keys (both forward and reverse) in one pass.

### Changes

#### `src/config/config.js`

Replace `FUZZY_THRESHOLDS` object with single constant:

```js
// Before
export const FUZZY_THRESHOLDS = {
  FORWARD: 0.7,
  REVERSE: 0.5,
  DEFAULT: 0.6,
};

// After
export const FUZZY_THRESHOLD = 0.7;
```

Add TODO comment to relevance thresholds:

```js
// TODO: evaluate thresholds with real data from Langfuse traces
export const RELEVANCE_THRESHOLDS = { ... };
```

#### `src/matchers/matchers.js`

Simplify `findFuzzyMatch()` — single pass over all candidates:

```js
// Before: import { FUZZY_THRESHOLDS } from "../config/config.js";
// After:
import { FUZZY_THRESHOLD } from "../config/config.js";

// findBestMatch() — remove default threshold parameter
function findBestMatch(query, mappingData, threshold = FUZZY_THRESHOLD) {
  // ... unchanged logic
}

// Simplified findFuzzyMatch — single pass, single threshold
export function findFuzzyMatch(value, forward, reverse, threshold = FUZZY_THRESHOLD) {
  const normalized = value ? String(value).trim() : '';
  if (!normalized) return null;

  // Search forward mappings (source→target)
  const fwd = findBestMatch(normalized, forward, threshold);
  if (fwd) {
    const target = typeof fwd.value === 'string' ? fwd.value : fwd.value.target;
    return {
      target, method: 'fuzzy', confidence: fwd.score,
      timestamp: new Date().toISOString(), source: normalized,
      matched_key: fwd.key,
    };
  }

  // Search reverse mappings (target keys) with same threshold
  const rev = findBestMatch(normalized, reverse, threshold);
  if (rev) {
    return {
      target: rev.key, method: 'fuzzy', confidence: rev.score,
      timestamp: new Date().toISOString(), source: normalized,
      matched_key: rev.key,
    };
  }

  return null;
}
```

Key changes:
- Single `threshold` parameter (default 0.7) replaces separate `forwardThreshold`/`reverseThreshold`
- Same threshold for both forward and reverse search (was 0.7 vs 0.5)
- Remove `direction` field from result (no longer meaningful with same threshold)
- Import `FUZZY_THRESHOLD` instead of `FUZZY_THRESHOLDS`

#### `src/services/normalizer.js`

Simplify wrapper — no longer needs to pass threshold args:

```js
// Before
import { FUZZY_THRESHOLDS, ... } from "../config/config.js";
export function findFuzzyMatch(value, forward, reverse) {
  return findFuzzyMatchDomain(value, forward, reverse,
    FUZZY_THRESHOLDS.FORWARD, FUZZY_THRESHOLDS.REVERSE);
}

// After — just re-export, or simplify wrapper
export function findFuzzyMatch(value, forward, reverse) {
  return findFuzzyMatchDomain(value, forward, reverse);
}
```

Remove `FUZZY_THRESHOLDS` import (no longer used here — threshold comes from default parameter in `matchers.js`).

Update `processTermNormalization()` — remove `direction` from `logMatch()` call (line 49):

```js
// Before
logMatch({ ..., direction: fuzzy.direction }, getHeaders());

// After
logMatch({ ..., matched_key: fuzzy.matched_key }, getHeaders());
```

### Impact on logging

`backend-api/utils/langfuse_logger.py` — `log_fuzzy_match()` accepts `direction` parameter. After Wave 0, this will always be `None`. No code change needed — the field becomes unused but harmless. Wave 3 refactors this function anyway.

### Verification

1. Start TermNorm backend + open Excel add-in
2. Match terms that previously hit fuzzy (not cache, not LLM)
3. Verify matches still work — same terms match, similar confidence scores
4. Check that no errors in console

**Behavioral change:** Terms that previously matched only via reverse search at 0.5 threshold will now require 0.7 similarity to match. If they were genuinely good matches, they'll still match. If they were marginal (0.5-0.69 similarity), they'll fall through to LLM research — which produces better results anyway.

---

## WP 6.0b: GET /pipeline Endpoint + Pipeline Config JSON (Wave 1)

**Goal:** Expose complete pipeline config as a REST endpoint. PromptPotter's PipelineSchema parses this.

### Create `backend-api/config/pipeline.json`

```json
{
  "name": "TermNormPipeline",
  "version": "v2.0",
  "steps": [
    {
      "name": "cache_lookup",
      "type": "DeterministicFunction",
      "runtime": "frontend",
      "short_circuit": true,
      "config": {}
    },
    {
      "name": "fuzzy_matching",
      "type": "DeterministicFunction",
      "runtime": "frontend",
      "short_circuit": true,
      "config": {
        "threshold": 0.7
      }
    },
    {
      "name": "web_search",
      "type": "ExternalService",
      "runtime": "backend",
      "config": {
        "max_sites": 7,
        "num_results": 20,
        "content_char_limit": 800,
        "raw_content_limit": 5000
      }
    },
    {
      "name": "entity_profiling",
      "type": "LLMGeneration",
      "runtime": "backend",
      "config": {
        "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
        "temperature": 0.3,
        "max_tokens": 1800
      }
    },
    {
      "name": "token_matching",
      "type": "DeterministicFunction",
      "runtime": "backend",
      "config": {
        "max_token_candidates": 20,
        "relevance_weight_core": 0.7
      }
    },
    {
      "name": "llm_ranking",
      "type": "LLMGeneration",
      "runtime": "backend",
      "config": {
        "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
        "temperature": 0.0,
        "max_tokens": 4000,
        "ranking_sample_size": 20
      }
    }
  ]
}
```

Field descriptions:
- `runtime`: `"frontend"` or `"backend"` — who executes this step
- `short_circuit`: if `true`, pipeline stops when this step produces a result (cache hit = done)
- `config`: tunable parameters — values are defaults, can be overridden
- `type`: step category — `"LLMGeneration"` (LLM call), `"DeterministicFunction"` (pure logic), `"ExternalService"` (external API)

### Create `backend-api/api/pipeline.py`

```python
"""Pipeline configuration endpoint."""
import json
import logging
from pathlib import Path
from fastapi import APIRouter

logger = logging.getLogger(__name__)
router = APIRouter(tags=["pipeline"])

PIPELINE_CONFIG_PATH = Path(__file__).parent.parent / "config" / "pipeline.json"

@router.get("/pipeline")
async def get_pipeline():
    """Return the complete pipeline configuration."""
    config = json.loads(PIPELINE_CONFIG_PATH.read_text())
    return {"status": "ok", "data": config}
```

### Register router in `backend-api/main.py`

```python
# In imports section
from api import (
    system_router,
    research_router,
    experiments_router,
)

# Add to api/__init__.py or import directly:
from api.pipeline import router as pipeline_router

# In router registration:
app.include_router(pipeline_router)
```

Also update `backend-api/api/__init__.py` to export `pipeline_router`.

### Frontend reads config at init

Modify `src/services/normalizer.js` (or create `src/services/pipeline-config.js`):

```js
// Pipeline config — fetched from backend at init, falls back to defaults
let _pipelineConfig = null;

export async function fetchPipelineConfig() {
  try {
    const data = await apiGet(buildUrl('/pipeline'), {}, true);  // silent
    if (data) {
      _pipelineConfig = data;
      // Update fuzzy threshold from config
      const fuzzyStep = data.steps?.find(s => s.name === 'fuzzy_matching');
      if (fuzzyStep?.config?.threshold != null) {
        _fuzzyThreshold = fuzzyStep.config.threshold;
      }
    }
  } catch {
    // Fallback to hardcoded default — endpoint may be unavailable
  }
}

export function getPipelineConfig() {
  return _pipelineConfig;
}
```

Call `fetchPipelineConfig()` during session init (alongside `POST /sessions`).

Use the fetched threshold in `findFuzzyMatch()`:

```js
export function findFuzzyMatch(value, forward, reverse) {
  const threshold = _fuzzyThreshold ?? FUZZY_THRESHOLD;
  return findFuzzyMatchDomain(value, forward, reverse, threshold);
}
```

### Verification

```bash
# Start backend
cd backend-api && python -m uvicorn main:app --port 8000

# Test endpoint
curl http://localhost:8000/pipeline
# Should return: {"status": "ok", "data": {"name": "TermNormPipeline", "version": "v2.0", "steps": [...]}}

# Verify 6 steps in response
curl -s http://localhost:8000/pipeline | python -m json.tool | grep '"name"'
# cache_lookup, fuzzy_matching, web_search, entity_profiling, token_matching, llm_ranking
```

---

## WP 6.0c: Unified Tracing (Wave 3)

**Goal:** One Langfuse trace per query, all pipeline steps as observations.

### Current state

Frontend cache/fuzzy matches are logged via `POST /activities/matches` → fire-and-forget `logMatch()`. Backend creates **separate traces** per method:

- `log_cache_match()` — creates its own trace + cache_lookup observation
- `log_fuzzy_match()` — creates its own trace + fuzzy_matching observation
- `log_pipeline()` — creates its own trace + web_search/entity_profiling/token_matching/llm_ranking observations

**Problem:** No unified view. A query that goes cache miss → fuzzy miss → LLM creates 3 separate traces. A cache hit creates 1 trace with only cache_lookup. We can't see the full pipeline flow.

### Target

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

### 3a. Trace lifecycle endpoints

Add to `backend-api/api/pipeline.py`:

```python
from pydantic import BaseModel
from utils.langfuse_logger import create_trace, create_observation, create_score, update_trace

class TraceRequest(BaseModel):
    query: str
    session_id: str | None = None
    user_id: str | None = None

class StepReport(BaseModel):
    trace_id: str
    step_name: str  # "cache_lookup" | "fuzzy_matching"
    result: dict    # {target, confidence, matched_key, ...}
    latency_ms: float = 0

@router.post("/pipeline/trace")
async def create_pipeline_trace(req: TraceRequest):
    """Create a pipeline trace. Returns trace_id for step reporting."""
    trace_id = create_trace(
        name="termnorm_pipeline",
        input={"query": req.query},
        user_id=req.user_id or "anonymous",
        session_id=req.session_id,
        metadata={"method": "pending"},
        tags=["production"],
    )
    return {"status": "ok", "data": {"trace_id": trace_id}}

@router.post("/pipeline/steps")
async def report_pipeline_step(report: StepReport):
    """Report a frontend pipeline step result as an observation on an existing trace."""
    obs_type = "span"  # cache_lookup and fuzzy_matching are deterministic spans

    create_observation(
        trace_id=report.trace_id,
        type=obs_type,
        name=report.step_name,
        input={"query": report.result.get("source", "")},
        output=report.result,
    )

    # If this step produced a final result, update trace output
    if report.result.get("target") and report.result.get("method"):
        create_score(report.trace_id, "confidence", report.result.get("confidence", 0))
        if report.latency_ms:
            create_score(report.trace_id, "latency_ms", report.latency_ms)
        update_trace(report.trace_id, output={
            "target": report.result["target"],
            "method": report.result["method"],
            "confidence": report.result.get("confidence", 0),
        }, metadata={"method": report.result["method"]})

    return {"status": "ok"}
```

### 3b. Backend accepts trace_id

Modify `backend-api/api/research_pipeline.py` — `/matches` endpoint:

The `/matches` request body should accept an optional `trace_id`:

```python
# In the /matches endpoint handler
trace_id = body.get("trace_id")  # optional, from frontend

# Pass to log_pipeline:
log_pipeline(record, session_id=session_id, trace_id=trace_id)
```

Modify `backend-api/utils/langfuse_logger.py` — `log_pipeline()`:

```python
def log_pipeline(
    record: Dict[str, Any],
    session_id: str = None,
    batch_id: str = None,
    user_prompt: str = None,
    trace_id: str = None,  # NEW: use existing trace instead of creating new one
) -> str:
    query = record.get("source")
    method = record.get("method")

    # Use existing trace or create new one
    if trace_id is None:
        trace_id = create_trace(
            name="termnorm_pipeline",
            input={"query": query},
            user_id=session_id or "anonymous",
            session_id=session_id,
            metadata={"method": method, ...},
            tags=["production"],
        )
    # ... rest of function unchanged (observations, scores, update_trace)
```

This is backward compatible — if `trace_id` is not provided, behavior is identical to before.

### 3c. Frontend trace integration

Modify `src/utils/api-fetch.js` — add helpers:

```js
export const createPipelineTrace = (query, headers = {}) =>
  apiPost(buildUrl('/pipeline/trace'), { query }, headers, { silent: true });

export const reportPipelineStep = (traceId, stepName, result, latencyMs = 0, headers = {}) =>
  fireAndForget(apiPost(buildUrl('/pipeline/steps'),
    { trace_id: traceId, step_name: stepName, result, latency_ms: latencyMs },
    headers, { silent: true }
  ));
```

Modify `src/services/normalizer.js` — `processTermNormalization()`:

```js
export async function processTermNormalization(value, forward, reverse) {
  const startTime = performance.now();
  const normalized = value ? String(value).trim() : "";
  if (!normalized) return createMatchResult({ ... });
  if (!getStateValue('mappings.loaded')) { ... }

  // Create trace for this query
  const traceData = await createPipelineTrace(normalized, getHeaders());
  const traceId = traceData?.trace_id;

  // Tier 1: Cache lookup
  const cached = getCachedMatch(normalized, forward, reverse);
  if (cached) {
    const latency = performance.now() - startTime;
    if (traceId) reportPipelineStep(traceId, 'cache_lookup', { ...cached, source: normalized }, latency);
    return createMatchResult(cached);
  }
  // Report cache miss
  if (traceId) reportPipelineStep(traceId, 'cache_lookup', { source: normalized, method: 'miss' }, performance.now() - startTime);

  // Tier 2: Fuzzy matching
  const fuzzy = findFuzzyMatch(normalized, forward, reverse);
  if (fuzzy) {
    const latency = performance.now() - startTime;
    if (traceId) reportPipelineStep(traceId, 'fuzzy_matching', { ...fuzzy, source: normalized }, latency);
    return createMatchResult(fuzzy);
  }
  // Report fuzzy miss
  if (traceId) reportPipelineStep(traceId, 'fuzzy_matching', { source: normalized, method: 'miss' }, performance.now() - startTime);

  // Tier 3: LLM research — pass trace_id so backend adds to same trace
  const token = await findTokenMatch(normalized, traceId);
  if (token) return token;

  return createMatchResult({ target: "No matches found", method: "no_match", confidence: 0, source: normalized });
}
```

Update `findTokenMatch()` to accept and pass `trace_id`:

```js
export async function findTokenMatch(value, traceId = null) {
  // ... existing code ...
  const payload = { query: normalized, skip_llm_ranking: skipLlmRanking };
  if (traceId) payload.trace_id = traceId;
  const data = await executeWithSessionRecovery(() =>
    apiPost(buildUrl(SESSION_ENDPOINTS.RESEARCH), payload, getHeaders())
  );
  // ... rest unchanged ...
}
```

### Backward compatibility

- `POST /matches` without `trace_id` → creates its own trace (existing behavior)
- `POST /matches` with `trace_id` → attaches observations to existing trace
- Old frontend versions (without trace integration) continue to work
- `log_cache_match()` and `log_fuzzy_match()` become unused after this change but can stay for now (they're called from the old `logMatch` fire-and-forget path which gets replaced)

### Migration note

After Wave 3 is deployed and verified:
- Remove the old `logMatch()` fire-and-forget calls in `processTermNormalization()`
- `log_cache_match()` and `log_fuzzy_match()` in `langfuse_logger.py` can be deprecated (add `# DEPRECATED: use POST /pipeline/steps` comment)

### Verification

1. Process a term in Excel that triggers LLM research (cache miss + fuzzy miss)
2. Check `logs/langfuse/traces/` — should see **one** trace file
3. Check `logs/langfuse/observations/{trace_id}/` — should see observations for:
   - `cache_lookup` (miss)
   - `fuzzy_matching` (miss)
   - `web_search`
   - `entity_profiling`
   - `token_matching`
   - `llm_ranking`
4. Process a term that hits cache — one trace with only `cache_lookup` observation
5. Process a term that hits fuzzy — one trace with `cache_lookup` (miss) + `fuzzy_matching` (hit)

---

## Files Summary

| File | WP | Action | What changes |
|------|----|--------|-------------|
| `src/config/config.js` | 6.0a | MODIFY | `FUZZY_THRESHOLDS` → `FUZZY_THRESHOLD = 0.7`, add TODO to relevance thresholds |
| `src/matchers/matchers.js` | 6.0a | MODIFY | Single `threshold` param, remove `direction`, import `FUZZY_THRESHOLD` |
| `src/services/normalizer.js` | 6.0a, 6.0b, 6.0c | MODIFY | Drop threshold args (0a), fetch pipeline config (0b), trace integration (0c) |
| `backend-api/config/pipeline.json` | 6.0b | CREATE | 6-step pipeline config JSON |
| `backend-api/api/pipeline.py` | 6.0b, 6.0c | CREATE/MODIFY | `GET /pipeline` (0b), `POST /pipeline/trace` + `POST /pipeline/steps` (0c) |
| `backend-api/api/__init__.py` | 6.0b | MODIFY | Export `pipeline_router` |
| `backend-api/main.py` | 6.0b | MODIFY | Register pipeline router |
| `backend-api/utils/langfuse_logger.py` | 6.0c | MODIFY | `log_pipeline()` accepts `trace_id` param |
| `backend-api/api/research_pipeline.py` | 6.0c | MODIFY | `/matches` accepts `trace_id`, passes to `log_pipeline()` |
| `src/utils/api-fetch.js` | 6.0c | MODIFY | Add `createPipelineTrace()`, `reportPipelineStep()` |

---

## Dependencies

```
WP 6.0a (fuzzy simplification)
  ↓
WP 6.0b (GET /pipeline)
  ↓
WP 6.0c (unified tracing)
```

6.0a must complete first — fuzzy simplification determines the config values in `pipeline.json`.
6.0c depends on 6.0b — trace endpoints live in the same `pipeline.py` file.
6.0c can run in parallel with PromptPotter WP 6.1 (PipelineSchema model).

---

## What This Enables (future, not in scope)

- PromptPotter sensitivity scan can see `fuzzy_matching.config.threshold` as a tunable parameter
- Langfuse traces show the complete pipeline — can evaluate fuzzy hit rate and accuracy
- Confidence thresholds can be iterated with real data from traces
- Pipeline config can be versioned and compared across experiments
