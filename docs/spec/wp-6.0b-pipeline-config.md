# WP 6.0b: Pipeline Config + Backend Fuzzy + GET /pipeline

> Parent: [Pipeline Composability Overview](README.md)

**Goal:** Expose pipeline config as a REST endpoint with nodes+pipelines schema. PromptPotter's PipelineSchema parses this. Add backend fuzzy matching with `rapidfuzz` for API-level evaluation.

---

## Architecture: Nodes + Pipelines

Each runtime (backend, frontend) gets its own config file with two sections:

- **`nodes`**: Registry of available processing steps, each with type + config. These are the building blocks.
- **`pipelines`**: Named arrangements of nodes. A REST request can specify a pipeline name OR an explicit node list via `steps`.

### Backend `backend-api/config/pipeline.json`

```json
{
  "name": "TermNorm",
  "version": "v1.1",
  "nodes": {
    "fuzzy_matching": {
      "type": "DeterministicFunction",
      "short_circuit": true,
      "config": {
        "threshold": 70,
        "scorer": "WRatio",
        "limit": 5
      }
    },
    "web_search": {
      "type": "ExternalService",
      "config": {
        "max_sites": 7,
        "num_results": 20,
        "content_char_limit": 800,
        "raw_content_limit": 5000,
        "scrape_timeout": 5,
        "search_engine_timeout": 10,
        "brave_api_timeout": 10,
        "searxng_timeout": 12,
        "http_content_limit": 50000,
        "min_page_text_length": 200,
        "max_page_text_length": 10000,
        "title_truncate_length": 100,
        "scrape_workers": 10,
        "scrape_url_multiplier": 2,
        "content_per_site_in_prompt": 500,
        "fallback_keywords_max": 8,
        "bot_mitigation_delay": 1,
        "skip_extensions": [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"],
        "skip_domains": ["academia.edu", "researchgate.net", "arxiv.org", "ieee.org"],
        "searxng_instances": [
          "https://searx.be", "https://searx.tiekoetter.com", "https://searx.ninja",
          "https://search.bus-hit.me", "https://paulgo.io", "https://searx.work",
          "https://opnxng.com"
        ]
      }
    },
    "entity_profiling": {
      "type": "LLMGeneration",
      "config": {
        "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
        "temperature": 0.3,
        "max_tokens": 1800,
        "output_format": "json",
        "prompt_family": "entity_profiling",
        "prompt_version": 1,
        "schema_family": "entity_profile",
        "schema_version": 1
      }
    },
    "token_matching": {
      "type": "DeterministicFunction",
      "config": {
        "max_token_candidates": 20,
        "relevance_weight_core": 0.7,
        "tokenization_regex": "[a-zA-Z0-9]+",
        "high_confidence_threshold": 0.8,
        "correction_top_n": 10
      }
    },
    "llm_ranking": {
      "type": "LLMGeneration",
      "config": {
        "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
        "temperature": 0.0,
        "max_tokens": 4000,
        "output_format": "json",
        "ranking_sample_size": 20,
        "prompt_family": "llm_ranking",
        "prompt_version": 1,
        "ranking_schema": {
          "type": "object",
          "properties": {
            "profile_summary": { "type": "string" },
            "core_concept_description": { "type": "string" },
            "ranked_candidates": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "candidate": { "type": "string" },
                  "core_concept_score": { "type": "number" },
                  "spec_score": { "type": "number" },
                  "evaluation_reasoning": { "type": "string" },
                  "key_match_factors": { "type": "array", "items": { "type": "string" } },
                  "spec_gaps": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["candidate", "core_concept_score", "spec_score",
                             "evaluation_reasoning", "key_match_factors"]
              }
            }
          },
          "required": ["profile_summary", "core_concept_description", "ranked_candidates"]
        }
      }
    }
  },
  "pipelines": {
    "default": ["web_search", "entity_profiling", "token_matching", "llm_ranking"],
    "with_fuzzy": ["fuzzy_matching", "web_search", "entity_profiling", "token_matching", "llm_ranking"],
    "fuzzy_only": ["fuzzy_matching"]
  },
  "llm_defaults": {
    "provider": "groq",
    "model": "meta-llama/llama-4-maverick-17b-128e-instruct",
    "timeout": 60,
    "retry_attempts": 3,
    "retry_backoff_base": 2,
    "token_estimation_multiplier": 1.3,
    "token_limit": 100000
  },
  "batch_overrides": {
    "max_sites": 5,
    "verbose": false
  }
}
```

No `cache_lookup` — backend can't execute it. Fuzzy threshold is 70 (rapidfuzz 0-100 scale).

#### Parameter reference

| Node | Parameter | Default | Source |
|------|-----------|---------|--------|
| `fuzzy_matching` | `threshold` | `70` | `fuzzy_matching.py:27` |
| | `scorer` | `"WRatio"` | `fuzzy_matching.py:28` |
| | `limit` | `5` | `fuzzy_matching.py:29` |
| `web_search` | `max_sites` | `7` | `research_pipeline.py:407` |
| | `num_results` | `20` | `research_pipeline.py:408` |
| | `content_char_limit` | `800` | `research_pipeline.py:409` |
| | `raw_content_limit` | `5000` | `research_pipeline.py:410` |
| | `scrape_timeout` | `5` | `web_generate_entity_profile.py:56` |
| | `search_engine_timeout` | `10` | `web_generate_entity_profile.py:80` |
| | `brave_api_timeout` | `10` | `web_generate_entity_profile.py:170` |
| | `searxng_timeout` | `12` | `web_generate_entity_profile.py:225` |
| | `http_content_limit` | `50000` | `web_generate_entity_profile.py:60` |
| | `min_page_text_length` | `200` | `web_generate_entity_profile.py:65` |
| | `max_page_text_length` | `10000` | `web_generate_entity_profile.py:65` |
| | `title_truncate_length` | `100` | `web_generate_entity_profile.py:69` |
| | `scrape_workers` | `10` | `web_generate_entity_profile.py:375` |
| | `scrape_url_multiplier` | `2` | `web_generate_entity_profile.py:373` |
| | `content_per_site_in_prompt` | `500` | `web_generate_entity_profile.py:298` |
| | `fallback_keywords_max` | `8` | `web_generate_entity_profile.py:294` |
| | `bot_mitigation_delay` | `1` | `web_generate_entity_profile.py:274` |
| | `skip_extensions` | 7 file types | `web_generate_entity_profile.py:44` |
| | `skip_domains` | 4 academic domains | `web_generate_entity_profile.py:45` |
| | `searxng_instances` | 7 public instances | `web_generate_entity_profile.py:209-217` |
| `entity_profiling` | `model` | `meta-llama/llama-4-maverick-17b-128e-instruct` | `llm_providers.py:11` |
| | `temperature` | `0.3` | `research_pipeline.py:411` |
| | `max_tokens` | `1800` | `research_pipeline.py:412` |
| | `output_format` | `"json"` | `web_generate_entity_profile.py:430` |
| | `prompt_family` | `"entity_profiling"` | `web_generate_entity_profile.py:306` |
| | `prompt_version` | `1` | `web_generate_entity_profile.py:307` |
| | `schema_family` | `"entity_profile"` | `research_pipeline.py:37` |
| | `schema_version` | `1` | `standards_logger.py:1079` |
| `token_matching` | `max_token_candidates` | `20` | `research_pipeline.py:416` |
| | `relevance_weight_core` | `0.7` | `research_pipeline.py:417` |
| | `tokenization_regex` | `[a-zA-Z0-9]+` | `research_pipeline.py:334` |
| | `high_confidence_threshold` | `0.8` | `research_pipeline.py:147` |
| | `correction_top_n` | `10` | `correct_candidate_strings.py:4` |
| `llm_ranking` | `model` | `meta-llama/llama-4-maverick-17b-128e-instruct` | `llm_providers.py:11` |
| | `temperature` | `0.0` | `call_llm_for_ranking.py:34` |
| | `max_tokens` | `4000` | `call_llm_for_ranking.py:34` |
| | `output_format` | `"json"` | `call_llm_for_ranking.py:86` |
| | `ranking_sample_size` | `20` | `call_llm_for_ranking.py:34` |
| | `prompt_family` | `"llm_ranking"` | `call_llm_for_ranking.py:54` |
| | `prompt_version` | `1` | `call_llm_for_ranking.py:55` |
| | `ranking_schema` | inline JSON schema | `call_llm_for_ranking.py:10-32` |

| Root section | Parameter | Default | Source |
|-------------|-----------|---------|--------|
| `llm_defaults` | `provider` | `"groq"` | `llm_providers.py:10` |
| | `model` | `meta-llama/llama-4-maverick-17b-128e-instruct` | `llm_providers.py:11` |
| | `timeout` | `60` | `llm_providers.py:98` |
| | `retry_attempts` | `3` | `llm_providers.py:86` |
| | `retry_backoff_base` | `2` | `llm_providers.py:113` |
| | `token_estimation_multiplier` | `1.3` | `llm_providers.py:38` |
| | `token_limit` | `100000` | `llm_providers.py:39` |
| `batch_overrides` | `max_sites` | `5` | `research_pipeline.py:692` |
| | `verbose` | `false` | `research_pipeline.py:694` |

**Schema notes:**
- `entity_profiling` references the schema registry (`schema_family`/`schema_version`) since it's already registered there.
- `llm_ranking` embeds `ranking_schema` inline because `RANKING_SCHEMA` is currently hardcoded in `call_llm_for_ranking.py` and not yet in the registry.

### Frontend `src/config/pipeline.json`

```json
{
  "name": "TermNorm-Frontend",
  "version": "v1.0",
  "nodes": {
    "cache_lookup": { "type": "DeterministicFunction", "short_circuit": true, "config": {} },
    "fuzzy_matching": {
      "type": "DeterministicFunction",
      "short_circuit": true,
      "config": { "algorithm": "levenshtein_word", "threshold": 0.7 }
    }
  },
  "pipelines": {
    "default": ["cache_lookup", "fuzzy_matching"],
    "cache_only": ["cache_lookup"]
  },
  "backend_pipeline": "default"
}
```

`algorithm: "levenshtein_word"` distinguishes from backend's `scorer: "WRatio"`. The `backend_pipeline` field declares which named pipeline arrangement the frontend invokes when local tiers miss. Webpack 5 imports JSON natively — no loader needed.

---

## 2A: Python Fuzzy Module

### Create `backend-api/research_and_rank/fuzzy_matching.py`

Uses `rapidfuzz` — MIT-licensed, C-optimized, the standard Python NLP library for string matching. Exposes multiple algorithms (ratio, partial_ratio, token_sort_ratio, WRatio) as a tunable `scorer` parameter that PromptPotter can sweep.

Two functions:
- `fuzzy_match_terms(query, candidates, threshold=70, scorer="WRatio", limit=5)` → list of `(candidate, normalized_score_0to1)`
- `fuzzy_match_mappings(query, forward, reverse, threshold, scorer)` → MatchResult dict or None

Scores normalized from rapidfuzz's 0-100 to 0.0-1.0 to match existing confidence model.

### Add `rapidfuzz` to `backend-api/requirements.txt`

---

## 2B: Pipeline Config + Endpoint

### `backend-api/config/pipeline.json`

Nodes+pipelines structure as shown above. 5 backend nodes, 3 named pipelines, plus `llm_defaults` and `batch_overrides` root sections for infrastructure parameters.

### `backend-api/api/pipeline.py`

- `GET /pipeline` → returns full config (nodes + pipelines + llm_defaults + batch_overrides)
- `POST /pipeline/trace` → creates trace with optional `pipeline_version` in metadata
- `POST /pipeline/steps` → reports frontend step results as observations

### `pipeline_version` in traces

`TraceRequest` accepts optional `pipeline_version` field. Stored in trace metadata so traces record which config version was active:

```python
class TraceRequest(BaseModel):
    query: str
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    pipeline_version: Optional[str] = None  # e.g. "v1.1"
```

Frontend sends `pipeline_version` from its local `src/config/pipeline.json`:

```js
const traceData = await createPipelineTrace(normalized, getHeaders(), frontendPipeline.version);
```

---

## 2C: Integrate Fuzzy into /matches

### Modify `backend-api/api/research_pipeline.py`

- Accept new params: `fuzzy_threshold` (default 70), `fuzzy_scorer` (default "WRatio")
- When `steps` includes `"fuzzy_matching"`, run `fuzzy_match_terms()` against session terms BEFORE web_search
- If `steps == ["fuzzy_matching"]`, short-circuit: return just fuzzy result with timing
- Add `fuzzy_matching` to `step_timings` dict
- Add fuzzy params to `_pipeline_params` echo
- Include fuzzy matches in response body

### PromptPotter evaluation examples

Fuzzy in isolation:
```
POST /matches {"query": "...", "steps": ["fuzzy_matching"], "fuzzy_threshold": 70, "fuzzy_scorer": "WRatio"}
```

Full pipeline including fuzzy:
```
POST /matches {"query": "...", "steps": ["fuzzy_matching", "web_search", "entity_profiling", "token_matching", "llm_ranking"]}
```

---

## Verification

```bash
# Start backend
cd backend-api && python -m uvicorn main:app --port 8000

# Test pipeline endpoint — should return full config (5 nodes, 3 pipelines, llm_defaults, batch_overrides)
curl http://localhost:8000/pipeline

# Test fuzzy-only mode (requires active session)
curl -X POST http://localhost:8000/matches \
  -H "Content-Type: application/json" \
  -d '{"query": "Chromium Oxide", "steps": ["fuzzy_matching"]}'

# Test trace with pipeline_version
curl -X POST http://localhost:8000/pipeline/trace \
  -H "Content-Type: application/json" \
  -d '{"query": "test", "pipeline_version": "v1.1"}'
# Trace metadata should include pipeline_version: "v1.1"

# Frontend verification:
# - npm test passes
# - Fuzzy uses threshold 0.7 from local src/config/pipeline.json
# - Trace creation sends pipeline_version: "v1.0"
# - backend_pipeline: "default" references backend's named pipeline
```
