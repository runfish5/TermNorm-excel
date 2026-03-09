# Pipeline Composability Standard

**Version:** 0.1 (draft)
**Date:** 2026-03-09

A lightweight JSON format for describing composable AI pipelines — their nodes, tunable parameters, named arrangements, and resolved registry artifacts. Designed for discovery-driven interoperability: a consumer reads the pipeline descriptor once and learns everything it needs to configure, execute, observe, and optimize the pipeline without hardcoded knowledge of its internals.

Analogous in spirit to [CWL](https://www.commonwl.org/) (Common Workflow Language) for bioinformatics pipelines, but narrower in scope: this standard targets LLM-augmented matching/ranking pipelines where the primary optimization surface is prompt engineering, model selection, and parameter tuning — not arbitrary DAG orchestration.

## Status

Infant standard. Two implementations exist:

| System | Role | Config location |
|--------|------|----------------|
| **TermNorm** (backend) | Producer — serves pipeline descriptor via `GET /pipeline` | `backend-api/config/pipeline.json` |
| **TermNorm** (frontend) | Producer — owns local tiers, declares `backend_pipeline` reference | `src/config/pipeline.json` |
| **PromptPotter** | Consumer — discovers pipeline, sweeps parameters, evaluates | `PipelineSchema` model + `parse_pipeline_response()` |

---

## 1. Core Concepts

### 1.1 Node

A single processing step with a declared type, tunable config, and optional registry references.

```jsonc
{
  "web_search": {
    "type": "ExternalService",
    "config": {
      "max_sites": 7,
      "num_results": 20,
      "scrape_timeout": 5
      // ... all tunable parameters
    }
  }
}
```

### 1.2 Pipeline

A named, ordered list of node keys. Represents one execution arrangement.

```jsonc
{
  "default": ["web_search", "entity_profiling", "token_matching", "llm_ranking"],
  "fast":    ["fuzzy_matching"]
}
```

### 1.3 Registry Reference

LLM nodes may reference versioned prompt templates and output schemas by family + version. These live in on-disk registries and are **resolved at request time** into the pipeline descriptor — never inlined into node configs.

```jsonc
// In node config (reference only):
"prompt_family": "entity_profiling",
"prompt_version": 1,
"schema_family": "entity_profile",
"schema_version": 1
```

```jsonc
// In top-level resolved_prompts / resolved_schemas (resolved):
"entity_profiling/1": {
  "family": "entity_profiling",
  "version": 1,
  "template_variables": ["query", "format_string", "combined_text"],
  "template": "You are a comprehensive technical database API..."
}
```

---

## 2. Pipeline Descriptor Format

The canonical JSON served by a producer (e.g., `GET /pipeline`).

### 2.1 Top-Level Structure

```jsonc
{
  // --- Required ---
  "name": "TermNorm",                   // Human-readable identifier for this pipeline descriptor
  "version": "v1.1",                    // Descriptor format version
  "nodes": { ... },                     // Node definitions (see §2.2)
  "pipelines": { ... },                 // Named pipelines (see §2.3)

  // --- Optional ---
  "available_models": [ ... ],          // Model IDs the producer supports
  "llm_defaults": { ... },             // Provider-level LLM settings (see §2.5)
  "cache": { ... },                     // Cache-layer settings
  "resolved_schemas": { ... },          // Resolved output schemas (see §2.6)
  "resolved_prompts": { ... }           // Resolved prompt templates (see §2.7)
}
```

**`name`** — A stable, human-readable identifier for the pipeline descriptor file. Consumers use this to distinguish between multiple pipeline sources (e.g., when a consumer connects to more than one producer). The name should be unique across producers in a given deployment.

### 2.2 Node Definition

Each key in `nodes` is the node's canonical name. The value is:

```jsonc
{
  "type": "<NodeType>",          // Required. See §3.
  "short_circuit": false,        // Optional. If true, pipeline stops when this node produces a result.
  "config": {                    // Required. ALL tunable parameters with current defaults.
    "<param_name>": "<value>",
    // ...
  }
}
```

**Completeness rule:** A config is not a list of what users change — it is a complete declaration of what the system assumes. If a value affects the node's behavior — threshold, limit, regex, model, multiplier, scorer — it MUST appear in `config`, even if the implementation currently hardcodes it and no current user would ever touch it. Beyond explicit parameters, producers should surface *assumptions*: domain beliefs baked into design (language, scale, ontology) where no parameter exists yet but a different deployment context would need one.

### 2.3 Pipeline Definition

```jsonc
{
  "<pipeline_name>": ["<node_name>", "<node_name>", ...]
}
```

Execution order matches array order. A consumer selects a named pipeline or provides an ad-hoc `steps` array at request time.

### 2.4 Frontend Descriptor Extensions

A frontend that delegates to a backend pipeline adds cross-runtime metadata:

```jsonc
{
  "name": "TermNorm-Frontend",
  "version": "v1.1",
  "nodes": { /* frontend-only nodes */ },
  "pipelines": { /* frontend-only pipelines */ },

  // --- Cross-runtime ---
  "backend_pipeline": "default",         // Which backend pipeline to invoke on miss
  "backend_default_steps": [ ... ],      // Default step list for the backend pipeline
  "backend_toggles": {                   // UI toggle → backend node mapping
    "useWebSearch": ["web_search"],
    "useLlmRanking": ["llm_ranking"]
  }
}
```

Each runtime owns only the nodes it can execute. A frontend's `fuzzy_matching` (e.g., Levenshtein, 0-1 scale) is a different implementation from a backend's (e.g., rapidfuzz WRatio, 0-100 scale). They share the same name but live in separate descriptors.

### 2.5 LLM Defaults

Provider-level infrastructure settings, separate from per-node LLM config:

```jsonc
{
  "llm_defaults": {
    "provider": "groq",
    "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
    "timeout": 60,
    "retry_attempts": 3,
    "retry_backoff_base": 2,
    "token_estimation_multiplier": 1.3,
    "token_limit": 100000
  }
}
```

### 2.6 Resolved Schemas

Output schemas resolved from the producer's schema registry. Keyed by `{family}/{version}`.

```jsonc
{
  "resolved_schemas": {
    "entity_profile/1": {
      "family": "entity_profile",
      "version": 1,
      "description": "Entity profile extraction schema",
      "fields": ["entity_name", "core_concept", "distinguishing_features"],
      "json_schema": { "type": "object", "properties": { ... } }
    }
  }
}
```

Consumers use `fields` and `json_schema` to understand what a node produces — for UI rendering, evaluation metric extraction, or prompt construction.

### 2.7 Resolved Prompts

Prompt templates resolved from the producer's prompt registry. Keyed by `{family}/{version}`.

```jsonc
{
  "resolved_prompts": {
    "entity_profiling/1": {
      "family": "entity_profiling",
      "version": 1,
      "description": "Extract entity profile from web research",
      "template_variables": ["query", "format_string", "combined_text"],
      "template": "You are a comprehensive technical database API..."
    }
  }
}
```

Consumers use `template_variables` to know which placeholders a custom prompt must provide, and `template` as a starting point for prompt engineering.

---

## 3. Node Types

| Type | Description | Registry refs | Example |
|------|-------------|---------------|---------|
| `DeterministicFunction` | Pure computation — same input always produces same output. May `short_circuit`. | None | fuzzy_matching, token_matching, cache_lookup |
| `ExternalService` | External API call (web search, scraping). No LLM involved. | None | web_search |
| `LLMGeneration` | LLM inference step. Carries `prompt_family`/`schema_family` references. Accepts `prompt`, `output_schema`, `model` overrides at request time. | `prompt_family`/`prompt_version`, `schema_family`/`schema_version` | entity_profiling, llm_ranking |

---

## 4. Execution Protocol

### 4.1 Session Lifecycle

Stateful producers require session initialization before pipeline execution:

```
POST /sessions { terms: [...] }  →  session created
POST /matches  { query, ... }    →  pipeline runs against session terms
```

### 4.2 Pipeline Execution Request

A consumer triggers pipeline execution by sending a query with optional overrides:

```jsonc
{
  "query": "Kupferblech CW004A",
  "steps": ["web_search", "entity_profiling", "token_matching", "llm_ranking"],
  "trace_id": "optional-trace-id",
  "node_config": {
    "<node_name>": {
      "<param>": "<override_value>"
    }
  }
}
```

**`node_config`** is the override mechanism. Each key is a node name; the value is a partial config dict merged over that node's defaults from `pipeline.json`. LLM nodes additionally accept three special override keys:

| Key | Purpose |
|-----|---------|
| `prompt` | Custom prompt template (replaces registry prompt) |
| `output_schema` | Custom JSON schema (replaces registry schema) |
| `model` | Override LLM model for this node |

No flat parameters are accepted — all overrides are namespaced under their node.

### 4.3 Pipeline Execution Response

```jsonc
{
  "status": "success",
  "data": {
    "ranked_candidates": [ ... ],         // Final output
    "entity_profile": { ... },            // Intermediate: LLM1 output
    "token_matched_candidates": [ ... ],  // Intermediate: deterministic scores
    "total_time": 14.2,
    "step_timings": {                     // Per-step wall-clock seconds
      "web_search": 3.1,
      "entity_profiling": 5.2,
      "token_matching": 0.01,
      "llm_ranking": 5.9
    },
    "terminated_at": "llm_ranking",       // Last step that ran
    "pipeline_params": { ... },           // Effective params snapshot (defaults + overrides)
    "web_search_status": "success",
    "llm_provider": "groq/llama-4-maverick"
  }
}
```

The response exposes intermediate outputs (`entity_profile`, `token_matched_candidates`) alongside the final result. This enables consumers to cache intermediates and replay only the steps that vary during optimization sweeps.

---

## 5. Discovery Protocol

The consumer-side protocol for learning a pipeline's structure at runtime.

### 5.1 Flow

```
Consumer                              Producer
   │                                     │
   ├── GET /pipeline ───────────────────►│  Resolve registry refs
   │◄── descriptor (nodes, schemas,      │  via _enrich_with_registries()
   │     prompts, pipelines)             │
   │                                     │
   │  Parse → internal model             │
   │  (e.g. PipelineSchema)              │
   │                                     │
   │  All tunable params, prompt         │
   │  templates, output schemas,         │
   │  and model options are now known.   │
   │                                     │
   ├── POST /matches { overrides } ─────►│  Execute with overrides
   │◄── results + step_timings           │
```

### 5.2 Consumer Model

A consumer parses the descriptor into a typed model. The reference implementation (PromptPotter's `PipelineSchema`) carries:

| Field | Type | Purpose |
|-------|------|---------|
| `name` | `str` | Pipeline identifier |
| `version` | `str` | Descriptor version |
| `steps` | `list[PipelineStep]` | Ordered step definitions |
| `available_models` | `list[str]` | Supported LLM models |

Each `PipelineStep` carries:

| Field | Type | Purpose |
|-------|------|---------|
| `name` | `str` | Node key (matches `nodes` dict key) |
| `type` | `str` | Node type (`DeterministicFunction`, `LLMGeneration`, `ExternalService`) |
| `runtime` | `str` | `"backend"` or `"frontend"` |
| `short_circuit` | `bool` | Pipeline stops on hit |
| `node_role` | `str` | Semantic role: `candidate_source`, `ranker`, `enricher`, `cache` |
| `param_keys` | `set[str]` | All flat parameter names for this step |
| `override_map` | `dict[str, str]` | Flat param name → wire key (e.g., `ranking_temperature` → `temperature`) |
| `observation_name` | `str` | Langfuse observation name |
| `observation_mappings` | `list[ObservationMapping]` | Field extraction rules for observability |
| `langfuse_type` | `str` | `"generation"`, `"tool"`, `"retriever"`, `"span"` |
| `output_schema` | `StepOutputSchema` | Resolved output schema (from `resolved_schemas`) |
| `prompt_meta` | `StepPromptMeta` | Resolved prompt metadata (from `resolved_prompts`) |
| `current_config` | `dict` | Current live config values |

### 5.3 Override Translation

Consumers may present a flat parameter namespace to users (e.g., `ranking_temperature`, `profiling_max_tokens`). The `override_map` per step translates these to the nested `node_config` wire format:

```
User-facing:  ranking_temperature = 0.5
                    │
                    ▼  override_map["ranking_temperature"] = "temperature"
Wire format:  node_config.llm_ranking.temperature = 0.5
```

The consumer builds `node_config` by iterating flat overrides, resolving each via `override_map`, and grouping by node name.

### 5.4 Live-Wins Merge

A consumer may carry static structural metadata (observation mappings, param keys, node roles) as defaults. When the live descriptor arrives from `GET /pipeline`, registry-owned metadata (`output_schema`, `prompt_meta`, `current_config`) from the response always overwrites static defaults. This ensures the consumer stays current without code changes when the producer evolves.

---

## 6. Registries

Producers maintain versioned registries for prompt templates and output schemas. These are resolved into the pipeline descriptor at request time — never inlined into node configs.

### 6.1 Schema Registry

```
logs/schemas/
├── entity_profile/
│   └── 1/
│       ├── schema.json        # Full JSON Schema
│       └── metadata.json      # { family, version, description, fields }
└── llm_ranking_output/
    └── 1/
        ├── schema.json
        └── metadata.json
```

### 6.2 Prompt Registry

```
logs/prompts/
├── entity_profiling/
│   └── 1/
│       ├── prompt.txt         # Template with {{variable}} placeholders
│       └── metadata.json      # { family, version, description, template_variables }
└── llm_ranking/
    └── 1/
        ├── prompt.txt
        └── metadata.json
```

Registry artifacts are committed to git (not runtime-initialized). The producer owns these artifacts; consumers read them from the live `GET /pipeline` response and never hardcode them.

---

## 7. Observability

### 7.1 Trace Lifecycle

One trace per query spans the full pipeline across runtimes:

```
Frontend                                  Backend
   │                                         │
   ├── POST /pipeline/trace ────────────────►│  Create trace
   │◄── { trace_id }                         │
   │                                         │
   ├── POST /pipeline/steps (cache_lookup) ──►│  Report frontend step
   ├── POST /pipeline/steps (fuzzy_matching) ►│  Report frontend step
   │                                         │
   │  [miss — fall through to backend]       │
   │                                         │
   ├── POST /matches { trace_id } ──────────►│  Backend continues trace
   │◄── results (steps logged as observations)│
```

### 7.2 Node Roles and Intermediate Metrics

Steps declare a `node_role` that enables automatic metric derivation:

| Role | Metric | Description |
|------|--------|-------------|
| `candidate_source` | `source_recall` | Fraction of queries where ground truth appears in candidates |
| `ranker` | `candidate_recall` | Fraction of ranked queries where ground truth was available |
| `cache` | `cache_hit_rate` | Fraction of queries resolved by cache |
| `enricher` | (none) | Enrichment steps don't produce independent metrics |

A composite score combines accuracy (top-1 match) with intermediate metrics:

```
composite = accuracy_weight * accuracy + Σ(metric_weight_i * metric_i)
```

---

## 8. Optimization Surface

A consumer optimizes a pipeline by sweeping a multi-dimensional search space. Each point in the space is fully described by:

```
SearchPoint = {
  prompt_state,       // Prompt template components (persona, task_intent, ...)
  model,              // LLM model ID
  temperature,        // Inference temperature
  pipeline_params     // node_config overrides
}
```

Content-addressed hashing of `(prompt_state, eval_data, model, temperature, pipeline_params)` enables deduplication — identical configurations are never re-evaluated.

### 8.1 Variant Library

Optimization axes are declared as a variant library:

```jsonc
{
  "prompt_fields": {
    "persona": ["", "You are a domain expert...", "..."],
    "task_intent": ["", "Your task is to identify...", "..."]
  },
  "pipeline_params": {
    "ranking_temperature": [0.0, 0.3, 0.5],
    "max_token_candidates": [10, 15, 20]
  }
}
```

Before a sweep, `filter_variant_library()` drops axes whose owning step is not in the active pipeline. This prevents wasted evaluations (e.g., don't sweep `ranking_temperature` when `llm_ranking` is excluded from `steps`).

### 8.2 Intermediate Caching

Steps 1-3 (web search, entity profiling, token matching) produce identical results for the same query regardless of the ranking prompt. A consumer can cache these after one full pipeline run and replay only the ranking step for each prompt variant:

```
Full run:     O(N queries × M combos × 20s)
With cache:   O(N × 20s  +  N × M × 2s)     ~10x speedup
```

The response format (§4.3) exposes intermediates to enable this.

---

## 9. Design Principles

1. **Latent parameter transparency** — A config is a complete declaration of what the system assumes, not a list of what users change. Every tunable parameter, implicit library default, and domain assumption should be named and discoverable. The `/audit-pipeline` skill enforces this by classifying findings as CONFIGURED, HARDCODED, IMPLICIT, HIDDEN, or ASSUMPTION.

2. **Discovery over convention** — Consumers learn the pipeline structure from the live descriptor. Adding a parameter, schema, or prompt to the producer makes it immediately available to all consumers without code changes.

3. **Split ownership** — Each runtime (frontend, backend) owns only the nodes it executes. No phantom nodes in configs.

4. **Node-scoped overrides** — `node_config` namespaces all overrides under their node key. No flat parameter collisions.

5. **Registry separation** — Prompt templates and output schemas live in versioned registries, resolved at request time into the descriptor. Node configs carry references, not inline content.

6. **Intermediates as first-class outputs** — Pipeline responses expose intermediate step outputs alongside final results, enabling caching and diagnostic inspection.

7. **One trace per query** — Observability spans runtimes. Frontend creates the trace; backend continues it.

---

## 10. Current Implementations

### 10.1 TermNorm (Producer)

| Component | File | Purpose |
|-----------|------|---------|
| Backend pipeline descriptor | `backend-api/config/pipeline.json` | Canonical node configs + named pipelines |
| Config loader | `backend-api/config/pipeline_config.py` | Single read at import; `get_node_config()`, `get_pipeline_steps()` |
| Discovery endpoint | `backend-api/api/pipeline.py` | `GET /pipeline` with `_enrich_with_registries()` |
| Execution endpoint | `backend-api/api/research_pipeline.py` | `POST /matches` with `_resolve_pipeline_params()` |
| Schema registry | `backend-api/utils/schema_registry.py` | `logs/schemas/{family}/{version}/` |
| Prompt registry | `backend-api/utils/prompt_registry.py` | `logs/prompts/{family}/{version}/` |
| Frontend descriptor | `src/config/pipeline.json` | Local tiers + `backend_pipeline` reference |
| Trace lifecycle | `backend-api/api/pipeline.py` | `POST /pipeline/trace`, `POST /pipeline/steps` |

**Backend nodes (v1.1):**

| Node | Type | Key params |
|------|------|-----------|
| `fuzzy_matching` | DeterministicFunction | `threshold` (70), `scorer` (WRatio), `limit` (5) |
| `web_search` | ExternalService | `max_sites` (7), `num_results` (20), `url_fetch_multiplier` (2), `fallback_keywords_limit` (8), `scrape_timeout` (5), `content_char_limit` (800) |
| `entity_profiling` | LLMGeneration | `model`, `temperature` (0.3), `max_tokens` (1800), `no_web_token_multiplier` (0.5), `prompt_family`/`schema_family` refs |
| `token_matching` | DeterministicFunction | `max_token_candidates` (20), `tokenization_regex` |
| `llm_ranking` | LLMGeneration | `model`, `temperature` (0.0), `max_tokens` (4000), `sample_size` (20), `debug_output_limit` (20), `relevance_weight_core` (0.7), `prompt_family`/`schema_family` refs |
| `direct_prompt` | LLMGeneration | `model`, `temperature` (0.0), `max_tokens` (300), `accept_threshold` (0.75), `correction_top_n` (10) |

### 10.2 PromptPotter (Consumer)

| Component | File | Purpose |
|-----------|------|---------|
| Pipeline fetch + parse | `api/services/pipeline_discovery.py` | `fetch_pipeline()`, `parse_pipeline_response()`, `TERMNORM_DEFAULT_SCHEMA` |
| Consumer model | `api/models/pipeline_schema.py` | `PipelineSchema`, `PipelineStep`, `StepOutputSchema`, `StepPromptMeta` |
| Execution client | `api/services/backend_client.py` | `run_match()`, `build_pipeline_params()` (flat → node_config translation) |
| Search point | `api/models/search_point.py` | `SearchPoint` bundles prompt + model + temperature + pipeline_params |
| Evaluation | `api/services/prompt_eval.py` | `backend_reranker_eval()` — single-query evaluation via `/matches` |
| Variant library | `api/config/prompt_variants.json` | Optimization axes (prompt fields + pipeline params) |
| Axis filtering | `api/services/search/smart_search.py` | `filter_variant_library()` — drops axes for inactive steps |
| Connector spec | `docs/connectors/termnorm.md` | Wire-level contract documentation |

**Key consumer behaviors:**

- **Live-wins merge**: `parse_pipeline_response()` merges live registry metadata onto `TERMNORM_DEFAULT_SCHEMA`. Live always wins.
- **Flat→wire translation**: `build_pipeline_params()` uses `override_map` from `PipelineStep` to translate user-facing flat params into nested `node_config`.
- **Content-addressed dedup**: `eval_content_hash()` includes `pipeline_params` so different configs produce distinct hashes.
- **Step-aware filtering**: `filter_variant_library()` drops optimization axes not owned by active pipeline steps.

---

## 11. Roadmap

- **v0.2**: Formalize node type contracts (input/output shapes per type)
- **v0.3**: DAG support — nodes reference upstream outputs by name instead of implicit positional ordering
- **v0.4**: Multi-producer support — a consumer discovers and composes pipelines from multiple backends
- **v1.0**: Stable format with backward-compatibility guarantees
