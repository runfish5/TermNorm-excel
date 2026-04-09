# Proper Step Loop

**Version:** 1.0.0
**Date:** 2026-04-09
**Status:** Implemented
**Scope:** PromptPotter (eval security gate) + TermNorm (`llm_only` pipeline step)

---

## Context

PromptPotter's optimizer holds LLM API keys for its own meta-reasoning (L1/L2/L3/critique). These keys must never be used for evaluation inference by default. Evaluation queries go through a backend server (TermNorm today, others via ConnectorProtocol in M11) that holds its own inference keys.

For benchmark datasets (GSM8K, HotPotQA), two evaluation paths exist:

1. **Backend-routed** (default) — `BackendClient` sends queries to TermNorm's `/matches` endpoint with `steps=["llm_only"]`. The backend holds inference keys. PromptPotter never sees them.

2. **Local LLM-only** (opt-in, gated) — `LLMOnlyAdapter` calls LLMs directly using the server's optimizer API keys. No backend needed. Gated behind admin-set secret because it costs money and must not be accidentally enabled, especially in multi-tenant self-hosted deployments.

This is the first security layer toward a secure webapp architecture. The patterns here (secret-gated access, single validation function, forward-compatible auth) apply to future features as PromptPotter moves toward whitelabel distribution.

---

## Part 1: PromptPotter Evaluation Security Gate

### Architecture

```
campaign.json                       .env (server admin)
  "dataset_type": "llm-only"         LOCAL_EVAL_SECRET=<secret>
  "local_eval_token": "<token>"
         |                                  |
         v                                  v
    init_services()  --->  _validate_local_eval_access()
         |                         |
         |                hmac.compare_digest(token, secret)
         |                         |
         v                         v
    LLMOnlyAdapter            ValueError (clear message)
    (authorized)              on any mismatch
```

### Settings

**File:** `promptpotter/config/settings.py`

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `LOCAL_EVAL_SECRET` | `str` | `""` | Admin-set secret. Empty = local eval disabled entirely. |

Empty by default. The admin of a self-hosted instance sets this in `.env` to allow local eval. Without it, all eval goes through the backend — no exceptions.

### Campaign Config Fields

**File:** `promptpotter/services/campaign/config.py` — `CampaignConfig`

| Field | Type | Description |
|-------|------|-------------|
| `dataset_type` | `str` | `"llm-only"` triggers `LLMOnlyAdapter` instead of `BackendClient` |
| `local_eval_token` | `str` | Must match `LOCAL_EVAL_SECRET` when `dataset_type == "llm-only"` |

`local_eval_token` is never committed to the repo. Users add it to their local `campaign.json` or pass via CLI. This prevents accidental cost from repo clones.

### Validation Function

**File:** `promptpotter/services/campaign/campaign_setup.py`

`_validate_local_eval_access(token)` — single validation point, called from `init_services()` before constructing `LLMOnlyAdapter`. Uses `hmac.compare_digest()` for constant-time string comparison.

**Three failure modes with clear messages:**

| Condition | Error |
|-----------|-------|
| `LOCAL_EVAL_SECRET` empty (admin hasn't enabled) | "LLM-only eval requested but local eval is not enabled. Set LOCAL_EVAL_SECRET in .env." |
| No `local_eval_token` provided (user forgot) | "LLM-only eval requested but no local_eval_token provided. Add it to campaign.json." |
| Token doesn't match secret (unauthorized) | "Invalid local_eval_token -- does not match LOCAL_EVAL_SECRET." |

### init_services() Signature

**File:** `promptpotter/services/campaign/campaign_setup.py`

```python
async def init_services(
    backend_url, backend_id, experiment_id,
    project_root, dataset_name,
    dataset_type=None,           # "llm-only" or None
    local_eval_token=None,       # must match LOCAL_EVAL_SECRET
    on_status=None,
) -> BackendContext:
```

When `dataset_type == "llm-only"`:
1. `_validate_local_eval_access(local_eval_token)` — raises `ValueError` on failure
2. `_create_llm_only_client(project_root, dataset_name)` — instantiates `LLMOnlyAdapter` with the optimizer's `LLMClientBase`
3. Status log: `"Backend: llm-only (authorized)"`

Otherwise: `BackendClient(backend_url)` — the default, unchanged path.

### LLMOnlyAdapter

**File:** `promptpotter/services/llm_eval_adapter.py`

Duck-type replacement for `BackendClient`. Implements the subset used by `eval_query_via_backend`:

| Method | Behavior |
|--------|----------|
| `run_query(query, pipeline_params, precomputed)` | Extracts system prompt from `pipeline_params[node]["prompt"]`, calls LLM, returns backend-compatible response dict |
| `check_status()` | Returns `{"status": "ok", "mode": "llm-only"}` |
| `fetch_pipeline()` | Returns minimal pipeline descriptor |
| `init_session(terms)` | No-op (no session needed) |
| `aclose()` | No-op |

The adapter does NOT hold API keys — it receives a pre-instantiated `LLMClientBase`. The system prompt flows through `pipeline_params` via the standard PromptTemplate path: `OptSearchPoint.render()` -> `to_job_search_point()` -> `pipeline_params[node]["prompt"]`.

### Entry Point Threading

Both entry points pass `dataset_type` and `local_eval_token` to `init_services()`:

| Entry Point | File | Source |
|-------------|------|--------|
| CLI | `promptpotter/cli/campaign_runner.py` | `file_config.get("dataset_type")`, `file_config.get("local_eval_token")` |
| Notebook | `promptpotter/ui/campaign/setup.py` | Function parameters |

### Forward Compatibility (Multi-Tenant)

`_validate_local_eval_access()` is the single control point. Future evolution without changing callers:

| Evolution | Change |
|-----------|--------|
| Per-user tokens | Replace `hmac.compare_digest` with DB/KV lookup keyed by token |
| Rate limiting | Wrap the function with a rate limiter keyed on token |
| Audit logging | Add a log line inside the function |
| Token rotation | Admin changes `LOCAL_EVAL_SECRET`; users get new token |
| Role-based access | Check token against a permissions table |

---

## Part 2: TermNorm — Pipeline Step Loop Refactor + `llm_only` Step

### Problem

TermNorm's `/matches` endpoint (`backend-api/api/research_pipeline.py`) is ~230 lines of nested if-branches with hardcoded dispatch, three early-exit patterns, and result builders tightly coupled to TermNorm-specific data shapes. Adding new steps (like `llm_only`) requires special casing. The existing `PipelineContext` (`backend-api/core/pipeline_context.py`) already tracks step status/timing/warnings but the dispatch code doesn't use it as the primary driver.

### Step 0: Revert Uncommitted direct_prompt Changes

Before refactoring, revert the uncommitted `direct_prompt` hack in the TermNorm repo:

```bash
cd TermNorm-excel
git checkout -- backend-api/api/research_pipeline.py backend-api/config/pipeline.json
```

This removes:
- `_run_direct_prompt_step()` function (39 lines added to research_pipeline.py)
- `if steps == ["direct_prompt"]` early-exit block (25 lines added to `/matches`)
- `direct_prompt` node config changes in pipeline.json (node_role, description, max_tokens, response_format, optimizer metadata)

The pipeline refactor introduces `llm_only` properly via the step registry — the `direct_prompt` hack is superseded.

### Target Architecture

A step registry + dispatch loop where adding `llm_only` (or any future step) is one registry entry, zero special casing.

```
Before (current):                     After (refactored):
230 lines of if-branches              STEP_REGISTRY = {
  if steps == ["direct_prompt"]:         "cache_lookup": _step_cache_lookup,
    # 25-line early exit                 "fuzzy_matching": _step_fuzzy,
  if "fuzzy_matching" in steps:          "web_search": _step_research,
    # 30 lines                           "entity_profiling": _step_research,
  if steps == ["fuzzy_matching"]:        "token_matching": _step_token,
    # another early exit                 "llm_ranking": _step_ranking,
  if "web_search" in steps:              "llm_only": _step_llm_only,
    # 70 lines nested                 }
  if "token_matching" in steps:
    # 20 lines                        for step_name in steps:
  # ranking always runs                  if step_name in precomputed:
  # (even when not in steps?!)              ctx.record_step(step_name, PRECOMPUTED)
                                            continue
                                         result = await STEP_REGISTRY[step_name](...)
                                         ctx.record_step(step_name, SUCCESS, result.elapsed)
                                         if result.terminates:
                                            break
```

### Step Interface

**File:** `backend-api/core/pipeline_context.py` (extend existing)

```python
@dataclass
class StepResult:
    """Uniform return type for all pipeline steps."""
    output: Any                    # step-specific data (fuzzy matches, entity profile, LLM answer, etc.)
    elapsed: float                 # seconds
    terminates: bool = False       # if True, pipeline stops after this step
    status: StepStatus = StepStatus.SUCCESS
    warnings: list[StepWarning] = field(default_factory=list)
```

Every step function has the same signature:

```python
async def _step_fuzzy(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    ...
async def _step_llm_only(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    ...
```

Arguments:
- `query` — the input query string
- `cfg` — merged node config (from `_resolve_pipeline_params()`)
- `ctx` — PipelineContext for accessing session terms, other step outputs, warnings

The existing helper functions (`_run_fuzzy_step`, `_run_research_step`, etc.) are wrapped — their internal logic stays, but they return `StepResult` instead of ad-hoc tuples.

### Step Registry

**File:** `backend-api/api/research_pipeline.py`

```python
STEP_REGISTRY: dict[str, Callable] = {
    "cache_lookup": _step_cache_lookup,
    "fuzzy_matching": _step_fuzzy,
    "web_search": _step_web_search,
    "entity_profiling": _step_entity_profiling,
    "token_matching": _step_token,
    "llm_ranking": _step_ranking,
    "llm_only": _step_llm_only,
}
```

Steps not in the registry are silently skipped (logged as warning).

### Session Relaxation

Derived from step metadata, not hardcoded per step name:

```python
# Steps that need session terms loaded
REQUIRES_SESSION = {"fuzzy_matching", "token_matching", "llm_ranking", "web_search", "entity_profiling"}

requires_session = bool(set(steps) & REQUIRES_SESSION)
if requires_session:
    # existing session/terms validation
```

`llm_only` and `cache_lookup` don't need sessions. No special casing — just not in the set.

### Dispatch Loop

**File:** `backend-api/api/research_pipeline.py` — replaces the 230-line dispatch block

```python
ctx = PipelineContext(query, user_id, requested_steps=steps, params=params)

for step_name in steps:
    if step_name not in STEP_REGISTRY:
        logger.warning("Unknown step %r — skipping", step_name)
        ctx.record_step(step_name, StepStatus.SKIPPED)
        continue

    # Use precomputed output if available
    if step_name in precomputed:
        ctx.record_precomputed(step_name, precomputed[step_name])
        continue

    cfg = params.get(step_name, {})
    try:
        result = await STEP_REGISTRY[step_name](query, cfg, ctx)
    except Exception as exc:
        logger.error("[PIPELINE] %s failed: %s", step_name, exc)
        ctx.record_step(step_name, StepStatus.FAILED)
        result = StepResult(output=None, elapsed=0.0, status=StepStatus.FAILED)

    ctx.record_step(step_name, result.status, elapsed=result.elapsed, warnings=result.warnings)
    ctx.set_output(step_name, result.output)

    if result.terminates:
        break
```

This replaces ALL the existing if-branches, early exits, and manual step orchestration.

### PipelineContext Extensions

Add to existing `PipelineContext`:

```python
def set_output(self, step_name: str, output: Any) -> None:
    """Store step output for downstream steps and response building."""
    self._outputs[step_name] = output

def get_output(self, step_name: str) -> Any:
    """Retrieve output from a previously executed step."""
    return self._outputs.get(step_name)

def record_precomputed(self, step_name: str, data: Any) -> None:
    """Record a precomputed step and store its output."""
    self.record_step(step_name, StepStatus.PRECOMPUTED)
    self._outputs[step_name] = data
```

Step functions access upstream outputs via `ctx.get_output("fuzzy_matching")` instead of passing data through function arguments.

### Response Building

Replace `_build_pipeline_results()` (currently coupled to entity_profile, candidates, ranking_debug) with a generic builder that reads from `PipelineContext`:

```python
def _build_response(ctx: PipelineContext) -> tuple[dict, dict]:
    """Build training_record and api_response from PipelineContext."""
    node_outputs = {name: ctx.get_output(name) for name in ctx.executed_steps if ctx.get_output(name) is not None}

    # final_ranking comes from the last ranker step's output
    final_ranking = []
    for step in reversed(ctx.executed_steps):
        out = ctx.get_output(step)
        if isinstance(out, dict) and "final_ranking" in out:
            final_ranking = out["final_ranking"]
            break
        if isinstance(out, list) and out and isinstance(out[0], dict) and "candidate" in out[0]:
            final_ranking = out
            break

    # ... build training_record and api_response from ctx ...
```

Existing TermNorm-specific formatting (entity_profile display, candidate ranking display) moves into the step functions' output format — the response builder is generic.

### `llm_only` Step Implementation

Just another registry entry:

```python
async def _step_llm_only(query: str, cfg: dict, ctx: PipelineContext) -> StepResult:
    """Generic LLM call — send prompt + query, get text response."""
    t0 = time.time()

    system = cfg.get("prompt", "")
    model = cfg.get("model")
    temperature = cfg.get("temperature", 0.0)
    max_tokens = cfg.get("max_tokens", 2000)
    response_format = cfg.get("response_format", "text")

    messages = [{"role": "user", "content": query}]
    kwargs = {"messages": messages, "temperature": temperature, "max_tokens": max_tokens, "model": model}
    if system:
        kwargs["system"] = system
    if response_format == "json":
        kwargs["output_format"] = "json"

    response = await llm_call(**kwargs)
    answer = response if isinstance(response, str) else response.get("output", json.dumps(response))
    elapsed = round(time.time() - t0, 3)

    return StepResult(
        output={"final_ranking": [{"candidate": answer.strip(), "score": 1.0}]},
        elapsed=elapsed,
        terminates=True,  # llm_only is a complete pipeline — nothing runs after it
    )
```

### pipeline.json Node Definition

**File:** `backend-api/config/pipeline.json` (TermNorm repo)

Add `llm_only` to the `nodes` section (NOT to the `default` pipeline):

```json
"llm_only": {
  "type": "generation",
  "runtime": "backend",
  "node_role": "ranker",
  "description": "Generic LLM call — send a system prompt + user query, get a text response. Bypasses all enrichment. No session or terms required.",
  "config": {
    "model": "openai/gpt-oss-120b",
    "temperature": 0.0,
    "max_tokens": 2000,
    "response_format": "text"
  },
  "optimizer": {
    "param_keys": ["prompt", "model", "temperature", "max_tokens", "response_format"],
    "param_descriptions": {
      "prompt": "System prompt sent to the LLM — the main optimization target",
      "model": "LLM model identifier",
      "temperature": "LLM sampling temperature",
      "max_tokens": "Maximum tokens in LLM response",
      "response_format": "Response mode: 'text' (raw LLM output) or 'json' (structured)"
    },
    "langfuse_type": "generation"
  }
}
```

Invoked explicitly via `steps=["llm_only"]` from PromptPotter's benchmark dataset configs.

### What Gets Deleted

| Code | Reason |
|------|--------|
| `_run_direct_prompt_step()` function | Replaced by `_step_llm_only` in registry |
| `if steps == ["direct_prompt"]` early-exit | Replaced by dispatch loop |
| `if steps == ["fuzzy_matching"]` early-exit | Handled by `terminates=True` on fuzzy step result |
| 230-line hardcoded dispatch block | Replaced by dispatch loop |
| `_build_node_outputs()` | Replaced by `ctx._outputs` |
| `_build_pipeline_results()` | Replaced by generic `_build_response(ctx)` |

### What Stays

| Code | Reason |
|------|--------|
| `_resolve_pipeline_params()` | Still needed — merges node_config with pipeline.json |
| `PipelineContext` | Extended with `_outputs`, `set_output()`, `get_output()`, `record_precomputed()` |
| `_summarize_response()` | Console logging — reads from response dict, stays generic |
| `log_pipeline()` | Langfuse tracing — called with training_record as before |
| Internal step logic | `fuzzy_match_terms()`, `call_llm_for_ranking()`, `llm_call()`, etc. — wrapped in step functions |

### Config Flow (PromptPotter -> TermNorm)

PromptPotter sends `pipeline_params` as `node_config` via `BackendClient.run_query()`. TermNorm's `_resolve_pipeline_params()` merges with `pipeline.json` defaults:

```
PromptPotter pipeline_params              TermNorm pipeline.json defaults
  {"llm_only": {                            {"llm_only": {
    "prompt": "You are a math tutor...",       "model": "openai/gpt-oss-120b",
    "temperature": 0.7                         "temperature": 0.0,
  }}                                           "max_tokens": 2000
                                            }}
           \                               /
            --> _resolve_pipeline_params() -->  merged config
```

### Logging (All Reused)

| Log Point | What Happens |
|-----------|-------------|
| Entry | `[PIPELINE] {user_id}: '{query}' (N terms)` — 0 terms for llm_only |
| Per-step | `ctx.record_step()` — tracked in PipelineContext automatically by dispatch loop |
| Exit | `_summarize_response()` — reads from response dict, all steps appear naturally |
| Langfuse | `log_pipeline()` — traces all executed steps |

### PromptPotter Dataset pipeline.json

**File:** `datasets/gsm8k/pipeline.json` (PromptPotter repo)

Mirrors the TermNorm node definition. PromptPotter loads this for `PipelineSchema` construction. The `llm_only` node appears with `runtime: "backend"` and the optimizer metadata that drives PromptTemplate decomposition and sensitivity scanning.

---

## Two Evaluation Modes — Summary

| Aspect | Backend-Routed (default) | Local LLM-Only (gated) |
|--------|--------------------------|----------------------|
| **Activation** | `dataset_type` absent or not `"llm-only"` | `dataset_type: "llm-only"` + valid `local_eval_token` |
| **Client** | `BackendClient` -> HTTP to `/matches` | `LLMOnlyAdapter` -> direct LLM call |
| **LLM keys for inference** | Held by backend server | Server's optimizer keys (shared) |
| **Backend required** | Yes | No |
| **Pipeline logging** | Full TermNorm pipeline logging + Langfuse | Minimal (adapter returns backend-compatible dict) |
| **Caching** | `IntermediateCache` + `dataset_run_store` | `dataset_run_store` only |
| **Use case** | Production, multi-tenant, auditable | Development, CI, offline benchmarking |

### When to Use Which

- **Backend-routed**: Default for all production and multi-tenant usage. Full observability, pipeline reuse, key separation. Requires a running TermNorm instance.
- **Local LLM-only**: When no backend is available (CI pipelines, offline development, reviewer reproduction). Requires explicit admin authorization via `LOCAL_EVAL_SECRET`.

---

## Dataset Config Pattern

Each benchmark dataset in `datasets/{name}/` supports both modes:

| File | Backend-Routed Fields | Local LLM-Only Fields |
|------|----------------------|----------------------|
| `campaign.json` | `dataset_name`, `scoring` | + `dataset_type: "llm-only"`, `local_eval_token` (user-provided) |
| `pipeline.json` | `llm_only` node with `runtime: "backend"`, optimizer metadata | Same file — used for schema loading |
| `dataset.md` | Documents backend prerequisites | Documents both modes |

---

## Testing

### PromptPotter

| Test | Verifies |
|------|----------|
| `test_rejects_when_no_secret` | `LOCAL_EVAL_SECRET` empty -> clear "not enabled" error |
| `test_rejects_missing_token` | No `local_eval_token` -> clear "add to campaign.json" error |
| `test_rejects_wrong_token` | Mismatch -> clear "invalid token" error |
| `test_accepts_correct_token` | Matching token -> no error, adapter created |
| `test_run_query_returns_backend_format` | `LLMOnlyAdapter.run_query()` returns standard response dict |
| `test_prompt_from_pipeline_params` | System prompt extracted from `pipeline_params[node]["prompt"]` |

### TermNorm

| Test | Verifies |
|------|----------|
| `/matches` with `steps=["llm_only"]` | Standard response with LLM answer in `final_ranking[0].candidate` |
| `/matches` with default steps | Full pipeline unchanged after refactor |
| `/matches` with `steps=["fuzzy_matching"]` | Single-step termination works via `terminates=True` |
| `/matches` with precomputed | Precomputed steps skipped, others execute |
| Console output | `[PIPELINE]` entry log + `_summarize_response()` exit present for all modes |
| Langfuse trace | All executed steps traced |
| Unknown step name | Logged as warning, skipped gracefully |
