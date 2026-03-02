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

### Modify `prompt-potter-optimizer/api/services/pipeline_discovery.py`

- `fuzzy_matching` PipelineStep: add `param_keys={"fuzzy_threshold", "fuzzy_scorer"}`
- Add `observation_mappings` for fuzzy result extraction

### Modify `prompt-potter-optimizer/api/services/backend_client.py`

- Add `"fuzzy_matching": {"fuzzy_threshold", "fuzzy_scorer"}` to `PIPELINE_STEP_PARAMS`

---

## End-to-End Flow

```
PromptPotter                                    TermNorm
────────────                                    ────────
1. GET /pipeline ──────────────────────────────► Returns 5-node config
   - Discovers fuzzy_matching step               with "name": "TermNorm"
   - Reads param_keys: threshold, scorer

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
   - Fuzzy hit-rate measurement
```

---

## Verification

1. `normalizer.js` reads threshold from local `src/config/pipeline.json`, no runtime fetch
2. PromptPotter `parse_pipeline_response()` matches `"termnorm"` in `_KNOWN_PIPELINES`
3. PromptPotter grid search with `fuzzy_threshold` / `fuzzy_scorer` axes works end-to-end
4. Trace shows complete pipeline journey for all scenarios (cache hit, fuzzy hit, LLM)
