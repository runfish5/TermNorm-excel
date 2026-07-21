# Improvement backlog

Time-bound working notes — deliberately kept OUT of `CLAUDE.md` (which holds durable rules only).
Line numbers are point-in-time; verify before editing.

## Status — verified 2026-07-21

Originated from the code-audit dated 2026-07-09 (PromptPotter-discipline review). Re-verified against
the actual tree on 2026-07-21 with `pytest` green (**18 passed**).

- **Arc 1 — structured-output seam: DONE** (and extended). One renderer (`format_string_from_schema`),
  one directive (`append_structure_directive`), `effective_schema = profiling_schema or schema` in both
  entity-profiling branches, `answer_field` on `llm_only`, `direct_prompt` re-expressed as a real
  `_DIRECT_PROMPT_SCHEMA` through the seam. Landed `b8205c8`, `44f21eb`, `ddba769`. Covered by
  `tests/test_ranking_prompt_contract.py`.
- **Arc 2 — kill shadow defaults: DONE.** `core/llm_providers.py` and `web_generate_entity_profile.py`
  read config as required (`cfg["key"]`); `reasoning_trace_cap` / `structured_output_mode` /
  `anthropic_max_tokens_default` now declared in `pipeline.json → llm_defaults`.
- **Arc 3 — collapse redundant mechanisms: DONE** (3a–3f closed, incl. 3b).
- **Arc 4 — error surfacing: DONE** (4a/4b/4c closed).
- **Arc 5 — god-file split: DONE** — `research_pipeline.py` 1344 → 547 lines; three modules carved out.

Release note: this is the TermNorm half of the **paired release** with PromptPotter (PP 0.8.8 pairs on
the web-search `strategy` axis + the structured-output seam). Local `master` was ahead of `origin` at
verification time — confirm push/tag when finalizing.

## What landed

- **3c/3d/4c** — token-score fallback folded into `_token_scores_as_ranking`; `EXPERIMENTS_PATH`
  single-sourced; `direct_prompt` no longer invents `confidence=0.5` (missing → `0.0`).
- **3b** — the two divergent match-DB upsert paths (`_update_db_entry` rebuild, `update` live) now
  share one canonical `_upsert_entry`; the alias + `web_sources` merge policy can no longer drift.
- **Arc 5 split** — `api/research_pipeline.py` (session store + `/matches` dispatch + endpoints) now
  imports from three carved-out modules:
  - `api/pipeline_steps.py` — the `_run_*` / `_step_*` step library + `STEP_REGISTRY` + serializers.
  - `api/response_builder.py` — `build_response` / `_response_data`, the one `/matches` envelope shape.
  - `api/frontend_logging.py` — the `/activities` telemetry router + its request models.
- **Safety net** — `tests/test_endpoint_contract.py` locks the `/sessions` · `/matches` · `/prompts`
  contract (IP auth, the stable `no_session` code, the success-envelope shape, pre-LLM validation).
  Suite: **24 passed**. Extend it as modules evolve.

The original audit is retained below only as provenance; every arc is closed.

## Repo hygiene (low, still open)

- `datetime.utcnow()` deprecation sweep — mostly handled via `utcnow_iso()`; confirm no stragglers.
- Pydantic V2 deprecation warning at `config/settings.py:10` (surfaced by `pytest`).
- `.env` holds live API keys on disk (gitignored, not in history) — rotate if that bar matters.
