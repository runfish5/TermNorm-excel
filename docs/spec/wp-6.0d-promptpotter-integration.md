# WP 6.0d: PromptPotter Integration

> Parent: [Pipeline Composability Overview](README.md)

**Goal:** Enable PromptPotter to discover, configure, and evaluate the full TermNorm pipeline including the new fuzzy matching step.

---

## 4A: Frontend Reads Pipeline Config

### `src/services/normalizer.js` — static import (no runtime fetch)

- Import `src/config/pipeline.json` as a static webpack 5 JSON module: `import frontendPipeline from "../config/pipeline.json"`
- Read fuzzy threshold from `frontendPipeline.nodes.fuzzy_matching.config.threshold`
- Read `backend_toggles` to build the backend `steps` array dynamically via `buildBackendSteps()` — disables backend nodes when the corresponding UI setting is off
- Send `frontendPipeline.version` as `pipeline_version` in trace metadata
- No runtime fetch of `GET /pipeline` — frontend uses local config only. `workflows.js` is unchanged.

---

## 4B: PromptPotter Cross-Repo Updates

### Pipeline discovery (`pipeline_discovery.py`)

- `TERMNORM_DEFAULT_SCHEMA` carries **structural metadata only**: observation_mappings, langfuse_type, param_keys, runtime. No hardcoded `output_schema` or `prompt_meta`.
- `parse_pipeline_response()` consumes `resolved_schemas`/`resolved_prompts` from the live `GET /pipeline` response and merges `StepOutputSchema`/`StepPromptMeta` onto matching steps. **Live always wins** — no `is None` guard.
- Three response formats handled: new top-level resolved, legacy inline, legacy steps list.
- `fuzzy_matching` PipelineStep: `param_keys={"fuzzy_threshold", "fuzzy_scorer"}`

### Smart search (`smart_search.py`)

- `filter_variant_library()` drops optimization axes not owned by active pipeline steps (e.g. drops `prompt_fields` when `llm_ranking` is inactive)

### Scan advisor (`scan_advisor.py`)

- Pipeline anatomy now includes `output_schema` (field names, descriptions) and `prompt_meta` (template variables, description) from registry metadata — gives the LLM advisor full pipeline visibility

### Backend client (`backend_client.py`)

- `fetch_pipeline()` calls `GET /pipeline` for live config
- `PIPELINE_STEP_PARAMS` includes `"fuzzy_matching": {"fuzzy_threshold", "fuzzy_scorer"}`

---

## End-to-End Flow

```
PromptPotter                                    TermNorm
────────────                                    ────────
1. GET /pipeline ──────────────────────────────► _enrich_with_registries()
   Response includes:                            resolves schema_family/
   - nodes (tunable params)                      prompt_family refs from
   - resolved_schemas (fields, JSON schema)      on-disk registries
   - resolved_prompts (template, variables)

   parse_pipeline_response() →
   PipelineSchema with StepOutputSchema
   + StepPromptMeta on each step

2. Grid search:
   POST /matches {                    ─────────► Runs fuzzy_matching step
     "query": "...",                              with specified params
     "steps": ["fuzzy_matching"],
     "fuzzy_threshold": 60,
     "fuzzy_scorer": "token_sort_ratio"
   }

3. Full pipeline evaluation:
   POST /matches {                    ─────────► Runs all backend steps
     "query": "...",                              including fuzzy
     "steps": ["fuzzy_matching",
               "web_search",
               "entity_profiling",
               "token_matching",
               "llm_ranking"],
     "fuzzy_threshold": 70,
     "fuzzy_scorer": "WRatio"
   }

4. Analyze results
   - hit@k metrics per step
   - McNemar test across configs
   - Scan advisor uses schema/prompt metadata
     for better axis recommendations
```

---

## Verification

1. `normalizer.js` reads threshold from local `src/config/pipeline.json`, no runtime fetch
2. PromptPotter `parse_pipeline_response()` matches `"termnorm"` in `_KNOWN_PIPELINES`
3. PromptPotter grid search with `fuzzy_threshold` / `fuzzy_scorer` axes works end-to-end
4. Trace shows complete pipeline journey for all scenarios (cache hit, fuzzy hit, LLM)
