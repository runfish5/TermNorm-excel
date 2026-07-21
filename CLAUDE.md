# CLAUDE.md — TermNorm backend (Python server)

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this is

TermNorm is a **Python FastAPI server** that normalizes free-form text to standardized database
identifiers via a composable pipeline: cache lookup → fuzzy → web-search evidence → LLM entity
profiling → token matching → LLM ranking.

**It is the co-owned backend half of PromptPotter.** It was split into its own repo *for security
reasons only* — same project, same doctrine; the standing goal is to eliminate the split and fold
it back in when practical. **Cross-repo edits are authorized.** The PP↔TermNorm boundary is a
*shape contract*: touch one side, fix both.

It also serves an **Excel/Office.js add-in** (under `src/`), but that add-in is a *consumer* of
this server, not the center of the project. Frontend guidance lives in **`src/CLAUDE.md`** (a child
layer that loads when you work under `src/`). The center of gravity — and essentially all recent
work — is the server.

## Committing & pushing

**Don't commit by default: never `git commit` or `git push` unless the operator says so — a commit
ask is NOT a push ask, and "finish the release" is NOT a push ask either.** Mirrors the PromptPotter
root CLAUDE.md rule (co-owned project, same doctrine). Before committing, run the backend tests
(`cd backend-api && pytest -q`) and lint (`ruff check`, `npm run lint`) — note this repo is not
`ruff format`-clean as a baseline, so do NOT reformat existing files. Releases are cut as a dedicated
`chore(release): prepare vX.Y.Z` commit that bumps `package.json` + finalizes `CHANGELOG.md`, then a
matching annotated tag — all done locally and pushed only on the operator's explicit say-so.

## The contract (the server's reason to exist)

PromptPotter optimizes this server by reading its shape and sweeping its parameters. Three endpoints
are the contract:

| Endpoint | Method | Purpose |
|---|---|---|
| `/matches` | POST | Run one query. Body `{query, steps, node_config}`. Returns prediction, ranked candidates, `web_cost`, `diagnostics.warnings[]`. |
| `/pipeline` | GET | Full machine-readable shape: nodes, types, tunable params + allowed value-sets, and **resolved** prompts/schemas. Read once at init. |
| `/status` | GET | Liveness + throughput. |

- **Error envelope is TermNorm's `{status, message, code}`** (via `main.py`), *not* FastAPI's
  `{detail}`. Clients (PromptPotter's session self-heal) key on a stable `code`. Endpoints must
  **raise into this envelope**, never return HTTP 200 with `{"status": "error"}`.
- **`node_config`** is the only accepted override shape: per-node dicts, e.g.
  `{"entity_profiling": {"output_schema": {...}, "prompt": "...", "model": "..."}}`. Flat params
  are rejected. See `docs/spec/README.md`.
- This server pairs with PromptPotter releases (e.g. PP 0.8.8 pairs on the web-search `strategy`
  axis + the structured-output seam). When you change the contract, the paired half moves too.

## Backend Commands

```bash
cd backend-api
python -m venv .venv
.\.venv\Scripts\activate    # Windows
pip install -r requirements.txt
python -m uvicorn main:app --reload                              # local dev
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload  # network
python -m pytest -q                                             # tests
```

Or use `start-server-py-LLMs.bat` for one-click startup.

## Backend Architecture (backend-api/)

- **main.py**: FastAPI app entry point; owns the standard error envelope.
- **api/**: Route handlers
  - `research_pipeline.py` - `/sessions`, `/matches`, `/batches`, `/prompts`, `/activities`
  - `system.py` - `/health`, `/status`, `/settings`, `/history`, `/cache`
  - `pipeline.py` - `/pipeline` (registry resolution via `_enrich_with_registries()`), `/pipeline/trace`, `/pipeline/steps`
  - `experiments_api.py` - `/experiments/*` for eval/optimization integration
- **core/**: Infrastructure
  - `llm_providers.py` - Unified Groq/OpenAI/OpenRouter interface (`llm_call`), retry + self-repair, native structured output
  - `throughput.py` - In-process request-timestamp window (load-average style)
  - `logging.py`, `log_format.py` - Backend logging + tag painting
  - `user_manager.py` - IP-based user authentication
- **research_and_rank/**: AI pipeline nodes
  - `web_generate_entity_profile.py` - Web-search evidence gathering + entity extraction
  - `call_llm_for_ranking.py` - LLM candidate ranking
  - `correct_candidate_strings.py` - Fuzzy correction of LLM outputs
  - `fuzzy_matching.py` - rapidfuzz-based fuzzy matching (threshold 70, WRatio)
  - `display_profile.py` - Entity profile formatting
- **utils/**:
  - `schema_registry.py` - Versioned JSON schema management. **Sole owner** of schema→prompt rendering (`format_string_from_schema` / `append_structure_directive`) — see "Structured-output seam" below.
  - `prompt_registry.py` - Versioned prompt management + `substitute_vars`/`render_prompt`
  - `langfuse_logger.py` - Langfuse-compatible logging
  - `standards_logger.py`, `cache_metadata.py`, `responses.py`, `id_gen.py`, `utils.py`
- **config/**: `settings.py`, `middleware.py`, `users.json` (hot-reload), `pipeline.json` (v1.1 — all tunable params)
- **logs/**: Runtime data
  - `match_database.json` - Persistent match cache
  - `langfuse/` - Traces, observations, scores, datasets
  - `prompts/` - Versioned LLM prompts (defaults committed to git)
  - `schemas/` - Versioned JSON schemas (`entity_profile`, `llm_ranking_output`) — committed, resolved at request time by `GET /pipeline`

## The server's features

### 1. Pipeline composability
`nodes` + `pipelines` JSON format shared across backend, frontend, and PromptPotter. `GET /pipeline`
(v1.1) exposes every tunable param. `LLMGeneration` nodes carry `schema_family`/`prompt_family`
references; `_enrich_with_registries()` resolves them from on-disk registries into top-level
`resolved_schemas`/`resolved_prompts` — so external consumers (PromptPotter) see field names,
descriptions, template variables, and JSON schemas with **no hardcoded metadata**. Named pipelines
in `pipeline.json` (`default`, `llm_only`) select *which nodes run*.

### 2. Config completeness — `pipeline.json` is the single source of truth
`pipeline.json` is a **complete declaration of what the system assumes**, not just a list of what
users change. If a value is a parameter of a node's implementation (threshold, limit, regex, model,
etc.), it MUST be declared in that node's config — even if the code currently hardcodes it and nobody
tweaks it today. Never delete a param because current code ignores it; **wire it**. Never hardcode a
fallback that should be configurable.

**No shadow defaults**: pipeline functions must NOT carry parameter defaults that duplicate
`pipeline.json` values. Config-sourced params are **required** (`cfg["key"]`, no `.get(key, default)`)
— a shadow default silently hides a broken contract and drifts from config. Use `/audit-pipeline` to
surface hardcoded values, implicit library defaults, and domain assumptions.

### 3. Structured-output seam — one seam, every LLM node
The output schema is a **variable, direct lever on every LLM node**. A node sets `output_schema` in
its config and the rest is automatic: `schema_registry.format_string_from_schema` renders the schema
(preserving property order, `description`, and `enum` — all of which steer generation), and
`append_structure_directive` (the sole owner of the "return exactly this" wording) injects it. The
same declaration feeds both the prompt and the decoder — no split-brain, no per-node duplication.
`llm_only` and `direct_prompt` additionally carry `answer_field` to declare which slot *is* the
answer. There is exactly one renderer; never reintroduce a second, lossy one.

### 4. Web-search strategy axis
**Brave only** — one metered query per match (free tier 2,000/month). No secondary provider; with no
key the node fails soft to LLM-knowledge-only. Toggle via `USE_BRAVE_API=true/false` in `.env`.

The `web_search` node has **3 strategies** (`web_search.config.strategy`), all on the *same* single
Brave query — they differ only in how that query becomes evidence:
1. **`snippets`** — use the text Brave already returns. No page fetches: instant, fewest tokens; shallowest.
2. **`scrape`** — fetch the full pages (deepest evidence) under a hard `scrape_budget` deadline; slower, more tokens. PDF datasheets extracted when `extract_pdf` is on.
3. **`hybrid`** *(default)* — `scrape`, falling back to each source's snippet on failure/timeout. Never empty, never hangs.

`strategy` is a swept optimizer axis; each match's `web_cost` block (`brave_queries`/`scrape_ok`/
`scrape_failed`/`evidence_chars`, on `/matches` + langfuse) lets PromptPotter pick the most-
efficiently-true mode on ground truth. Full rationale: `backend-api/docs/WEB_SEARCH_STRATEGY.md`;
30-second decision guide: `backend-api/docs/WEB_SEARCH_STRATEGY_QUICKPICK.md`.

> **⚠ Provisional — new in v1.2.0, not settled doctrine.** The `strategy` axis works and ships, but
> it is a **borderline layer under review**, not a fixed invariant. It carries an *overlapping-control*
> smell: (a) the three-value enum is really **two code paths** — `snippets` vs `scrape` — plus a
> boolean (`hybrid` = `scrape` + snippet-on-failure), so "3 strategies" overstates the implementation;
> and (b) it overlaps with pipeline/step selection, which *already* decides whether web evidence is
> gathered at all. Keep it for now, but **do not build hard dependencies on the three-way shape** — it
> is a candidate for consolidation. If you touch it, prefer collapsing the overlap over extending it.

### 5. Observability — langfuse logging, throughput, reasoning traces
Backend logs to `logs/langfuse/` in Langfuse-compatible format:
```
logs/langfuse/
├── traces/                    # lean workflow summaries (input/output)
├── observations/{trace_id}/   # verbose per-step data (web_search, entity_profiling, …)
├── scores/                    # evaluation metrics
└── datasets/                  # ground truth; items link back via source_trace_id
```
Trace IDs are datetime-prefixed: `YYMMDDHHMMSSxxxxxxxx…`. Full spec:
`backend-api/docs/LANGFUSE_DATA_MODEL.md`. Throughput rides `core/throughput.py` (see Dev Notes).

## Backend Key Patterns

1. **Session-Based**: No database — in-memory state with JSON persistence.
2. **Three-Tier Matching**: Cache → Fuzzy → LLM. Best result is always written (0.9 threshold is UI color only).
3. **IP-Based Auth**: Users in `backend-api/config/users.json` (hot-reload); optional bearer-token wire auth.
4. **Node-config ownership**: `/matches` merges per-node config dicts — no silent half-merges, no flat params.

## Configuration Files (backend)

- `backend-api/.env` - Environment variables (API keys, `USE_BRAVE_API`)
- `backend-api/config/users.json` - IP-based auth (hot-reload)
- `backend-api/config/pipeline.json` - Pipeline node configs, named pipelines, LLM defaults (v1.1)

## Development Notes

- **Console color is level-only + centralized**: call sites emit plain `[TAG] body` via `logger.*`; `core.logging.ConsoleFormatter` paints the tag **only** for WARNING (yellow) / ERROR (red) — INFO tags stay neutral. The one INFO color is the `[RESP]` outcome word (`core.log_format.paint`). Never re-add inline `{COLOR}…{RESET}` or per-stage tag color at a call site, and keep the file handler plain so `logs/app.log` stays ANSI-free.
- **Per-request stream shape**: effective LLM config prints once-on-change (`[CFG ]`, keyed on `_last_cfg_sig` in `research_pipeline.py`), not per request; each request is `[REQ ]` (path·steps·size·query) then `[RESP]` (outcome·time·tokens·cost·→answer), a blank line between requests. `[LLM ]` dispatch is DEBUG. Don't reintroduce per-request config/dispatch echo.
- **Throughput/utilization** rides `core/throughput.py` — an in-process request-timestamp window (no side-car metrics store). Surfaced as a throttled `[LOAD]` console heartbeat (1m/5m/15m req/min) and a Dropwizard-`Meter`-shaped `throughput` block (`count`, `rate_{1,5,15}m`) on `/status`. Reuse `throughput.record()`/`snapshot()`; don't add a parallel counter.
- **Archive folder**: `backend-api/.archive/` contains migration scripts needed until v1.3.0. Do not remove.

## Known Limitations

1. **Single Excel Instance Per Project**: Each Excel file runs its own add-in instance with isolated state (frontend concern — see `src/CLAUDE.md`).

## Frontend

The Excel/Office.js add-in that consumes this server is documented in **`src/CLAUDE.md`**, which
Claude Code loads automatically when you work under `src/`. It declares `backend_pipeline: "default"`
and owns its own local matching tiers.

## Backlog

Open code-quality residuals and the deferred `research_pipeline.py` split live in
`backend-api/docs/IMPROVEMENT_BACKLOG.md` — **not here**. This file holds durable rules only: no
dates, no commit hashes, no `file:line`, no TODOs, no "not pushed" status. Anything time-bound goes
in the backlog doc or an issue.
