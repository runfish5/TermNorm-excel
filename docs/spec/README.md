# TermNorm Pipeline Composability — Spec Overview

TermNorm's pipeline is composable, evaluable, and discoverable. Each runtime — backend, frontend, and external optimizers — exposes its processing steps as `nodes` + `pipelines` in a shared JSON format. This enables cross-repo discovery: an optimizer like PromptPotter reads the pipeline schema, learns which parameters are tunable, and runs evaluations without hardcoded knowledge of the backend.

| Participant | Config | Role |
|-------------|--------|------|
| Backend | `backend-api/config/pipeline.json` → `GET /pipeline` | Exposes research pipeline with all tunable params |
| Frontend | `src/config/pipeline.json` | Owns local tiers (cache, fuzzy), declares `backend_pipeline` reference |
| PromptPotter | `PipelineSchema` model | Discovers backend pipeline, sweeps parameters, evaluates |

## Architecture

```
Nodes + Pipelines — Split Config
════════════════════════════════

Frontend (src/config/pipeline.json)     Backend (backend-api/config/pipeline.json)
┌─────────────────────────────┐        ┌──────────────────────────────────────┐
│ Nodes:                      │        │ Nodes:                               │
│  cache_lookup               │        │  fuzzy_matching (rapidfuzz, 0-100)   │
│    DeterministicFn, SC      │        │    DeterministicFn, SC               │
│  fuzzy_matching             │        │  web_search                          │
│    DeterministicFn, SC      │        │    ExternalService                   │
│    levenshtein_word, 0.7    │        │  entity_profiling                    │
│                             │        │    LLMGeneration                     │
│ Pipelines:                  │        │  token_matching                      │
│  default: cache → fuzzy     │        │    DeterministicFn                   │
│  cache_only: cache          │        │  llm_ranking                         │
│                             │        │    LLMGeneration                     │
│ backend_pipeline: "default" │        │                                      │
│ backend_default_steps: [..] │        │ Pipelines:                           │
│ backend_toggles: {..}       │        │  default: web→EP→TM→LLM             │
│                             │        │  with_fuzzy: fuzz→web→EP→TM→LLM     │
│ version: v1.1               │        │  fuzzy_only: fuzz                    │
└────────┬────────────────────┘        │                                      │
         │ miss                        │ version: v1.1                        │
         └────────────────────────────►└──────────────────────────────────────┘
```

Each runtime owns its own config. The frontend's `fuzzy_matching` (Levenshtein, 0-1 scale) is a different implementation from the backend's (rapidfuzz WRatio, 0-100 scale). `cache_lookup` is frontend-only — the backend can't execute it.

## Interface Protocol

The shared contract follows a discovery pattern:

```
Optimizer (PromptPotter)              Backend (TermNorm)
     │                                  │
     ├── GET /pipeline ────────────────►│  _enrich_with_registries() resolves
     │◄── pipeline config ─────────────│  schema_family/prompt_family refs from
     │                                  │  on-disk registries (logs/schemas/,
     │  Response includes:              │  logs/prompts/)
     │  - nodes (tunable params)        │
     │  - resolved_schemas (fields,     │
     │    descriptions, JSON schema)    │
     │  - resolved_prompts (template,   │
     │    template_variables)           │
     │                                  │
     │  Parse → PipelineSchema with     │
     │  StepOutputSchema + StepPromptMeta│
     │                                  │
     ├── POST /matches {param_combo} ──►│  Execute pipeline with overrides
     │◄── results + step_timings ───────│
     │  ... repeat for grid search ...  │
```

**Node schema** — each node declares:
- `type`: `DeterministicFunction` | `ExternalService` | `LLMGeneration`
- `short_circuit`: pipeline stops if this node produces a result
- `config`: all tunable parameters with current defaults

**Pipeline schema** — named arrangements referencing node keys:
```json
{ "default": ["web_search", "entity_profiling", "token_matching", "llm_ranking"] }
```

A frontend declares which backend pipeline it invokes via `backend_pipeline: "default"`.

**Two pipeline modes** (setting, not config):
- **Mode 1** (current): JS handles cache+fuzzy, FastAPI handles web+LLM steps
- **Mode 2** (future): Full pipeline through FastAPI — pass all step names to `/matches`

## Phase Summary

| Phase | WP | Description | Status |
|-------|----|-------------|--------|
| 0 | — | Docs restructure (this directory) | [x] |
| 1 | 6.0a | [Simplify frontend fuzzy](wp-6.0a-fuzzy-simplification.md) | [x] |
| 2A | 6.0b | [Backend fuzzy module (rapidfuzz)](wp-6.0b-pipeline-config.md#2a-python-fuzzy-module) | [x] |
| 2B | 6.0b | [Pipeline config JSON + GET /pipeline](wp-6.0b-pipeline-config.md#2b-pipeline-config--endpoint) | [x] |
| 2C | 6.0b | [Integrate fuzzy into /matches](wp-6.0b-pipeline-config.md#2c-integrate-fuzzy-into-matches) | [x] |
| 3A | 6.0c | [Trace lifecycle endpoints](wp-6.0c-unified-tracing.md#3a-trace-lifecycle-endpoints) | [x] |
| 3B | 6.0c | [Backend accepts trace_id](wp-6.0c-unified-tracing.md#3b-backend-accepts-trace_id) | [x] |
| 3C | 6.0c | [Frontend trace integration](wp-6.0c-unified-tracing.md#3c-frontend-trace-integration) | [x] |
| 4A | 6.0d | [Frontend reads pipeline config](wp-6.0d-promptpotter-integration.md#4a-frontend-reads-pipeline-config) | [x] |
| 4B | 6.0d | [PromptPotter cross-repo updates](wp-6.0d-promptpotter-integration.md#4b-promptpotter-cross-repo-updates) | [x] |

## Dependency Graph

```
Step 0 (docs restructure)     ← can run first or in parallel with Phase 1
  |
Phase 1 (fuzzy simplification)
  |
  +---> Phase 2A (python fuzzy) + Phase 2B (pipeline.json + GET /pipeline)  [parallel]
          |
          v
        Phase 2C (fuzzy in /matches)
          |
          v
        Phase 3 (unified tracing)   ← pipeline is configured, now make it observable
          |
          +---> Phase 4A (frontend reads config) + Phase 4B (PromptPotter)  [parallel]
```

## Pipeline Standard Specification

See **[pipeline-standard.md](pipeline-standard.md)** — the format specification for the nodes + pipelines JSON format, the discovery protocol, override mechanism, registry resolution, observability model, and optimization surface. Documents the interop contract between TermNorm (producer) and PromptPotter (consumer).

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Split config (frontend + backend) | Each runtime owns only the nodes it can execute. No `cache_lookup` in backend config; different fuzzy implementations don't share config. |
| Nodes + Pipelines schema | `nodes` are available building blocks with type + config. `pipelines` are named arrangements of nodes. REST `steps` param selects nodes at runtime. |
| `rapidfuzz` for backend fuzzy | MIT-licensed, C-optimized, standard Python NLP library. Exposes `scorer` param for PromptPotter sweeps. |
| Single threshold (0.7) | Removes overparameterization (was 3 thresholds: 0.7/0.5/0.6). Marginal reverse matches (0.5-0.69) fall through to LLM — better quality. |
| Pipeline name `"TermNorm"` | Lowercases to `"termnorm"` matching PromptPotter's `_KNOWN_PIPELINES` key. |
| One trace per query | Replaces 3 separate traces (cache/fuzzy/LLM). Enables full pipeline observability. |
| `pipeline_version` in traces | Trace metadata records which config version was active for reproducibility. |

## Files Summary

| File | Phase | Action |
|------|-------|--------|
| `src/config/config.js` | 1 | Modify: FUZZY_THRESHOLDS -> FUZZY_THRESHOLD |
| `src/matchers/matchers.js` | 1 | Modify: single threshold, no direction |
| `src/config/pipeline.json` | 4A | **Create**: frontend node registry + pipelines |
| `src/services/normalizer.js` | 1,3,4A | Modify: import local config, remove fetchPipelineConfig |
| `src/utils/api-fetch.js` | 3C | Modify: trace helpers, pipeline_version param |
| `src/services/workflows.js` | 4A | Modify: remove fetchPipelineConfig call |
| `backend-api/research_and_rank/fuzzy_matching.py` | 2A | **Create**: rapidfuzz backend fuzzy |
| `backend-api/requirements.txt` | 2A | Modify: add rapidfuzz |
| `backend-api/config/pipeline.json` | 2B | **Create**: nodes + pipelines (5 backend nodes, 3 pipelines) |
| `backend-api/api/pipeline.py` | 2B,3A | **Create**: GET /pipeline + trace endpoints + pipeline_version |
| `backend-api/api/__init__.py` | 2B | Modify: export pipeline_router |
| `backend-api/main.py` | 2B | Modify: register pipeline_router |
| `backend-api/api/research_pipeline.py` | 2C,3B | Modify: fuzzy step + trace_id |
| `backend-api/utils/langfuse_logger.py` | 3B | Modify: log_pipeline() accepts trace_id |
| PromptPotter `pipeline_discovery.py` | 4B | Modify: fuzzy param_keys |
| PromptPotter `backend_client.py` | 4B | Modify: PIPELINE_STEP_PARAMS |
