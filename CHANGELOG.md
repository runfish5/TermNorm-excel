# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.6] - 2026-05-27

### Highlights

**Pipeline Composability**
- Nested-only pipeline params — flat-prefixing and `override_map` removed; per-step `model` / `schema` / `prompt` via `node_overrides` (renamed `node_config` on `/matches`)
- `steps[]` is now the single source of truth for pipeline control
- Self-describing `pipeline.json` — optimizer metadata baked in; all hardcoded server defaults wired through `pipeline.json` (no shadow defaults)
- Per-key node-config merge with clear step/RESP logs (no silent half-merges)
- Required LLM params validated up front on `/matches`; `max_tokens` defaults removed from every generation node

**LLM Provider Expansion + Robustness**
- New OpenRouter provider with per-node provider routing (no global fallback)
- New `llm_only` pipeline step + reasoning-model hardening (see BREAKING below)
- 429 rate-limit handling forwards `Retry-After` per RFC 7231
- Structured-output truncation now retries without `max_tokens` instead of failing
- Decommissioned model swap + graceful LLM degradation
- `llm_ranking` defended against empty candidate lists and `None` slip-through
- Exposed previously hidden library params (seed, logprobs, Brave filters); unified fuzzy algorithm

**PromptPotter Integration**
- Registry-driven `GET /pipeline` — `_enrich_with_registries()` resolves `schema_family` / `prompt_family` references from on-disk registries into top-level `resolved_schemas` / `resolved_prompts` dicts (external consumers get full field metadata without hardcoded knowledge)
- New `/status` endpoint — single-snapshot aggregation of session, match DB, experiment, and pipeline info for external tools
- `step_tokens` carries raw LLM-call response shape on `usage_out` — `reasoning` token count (Groq/OpenAI), normalized `finish_reason` (`length` / `stop` / `content_filter` / `tool_use` regardless of provider), `max_tokens_requested`
- Per-LLM-node token usage emitted on `/matches`
- OpenRouter `usage.cost` forwarded as `cost_usd`
- `/matches` accepts pipeline parameter overrides + `ranking_prompt` override + `steps` selection + per-step timings
- `/matches` response exposes `entity_profile` and `token_matched_candidates`
- New `GET /experiments/{id}/mappings` endpoint
- `llm_ranking_output` schema committed to `logs/schemas/llm_ranking_output/1/`; both LLMGeneration nodes (`entity_profiling`, `llm_ranking`) use registry references
- Trace metadata derived from execution results (removed `use_web_search` server override)

**Logging & Diagnostics**
- Coherent lifecycle taxonomy with full upstream errors propagated structurally as 4xx + `[CFG]` log line
- Phase-coloured console output + condensed REQ/LLM/RESP logging
- Scrape diagnostics overhaul — accurate counts, condensed format, structured pipeline diagnostics
- Mature startup TUI — narrow-column banner with richer boot info
- Per-step logging primitive extracted; verbose LLM error log messages shortened

**Web Search**
- Simplified to Brave-only with `query_prefix` / `query_suffix` knobs

**First-Class Linux Support**
- New `start-server-py-LLMs.sh` — POSIX-bash launcher for Ubuntu/macOS, parity with the Windows `.bat`
- Portable `python3` detection with `python` fallback for 3.x interpreters
- `.venv` bootstrap on first run; requirements sync via `find -newer` (works on GNU + BSD/macOS `find`)
- Production launcher: uvicorn on `0.0.0.0:8000` *without* `--reload` (avoids the watchfiles INFO chatter that Linux `inotify` produces; Windows `.bat` left as-is)
- `.gitattributes` locks `*.sh` to `eol=lf` so Linux operators get LF line endings even when commits originate on Windows (`core.autocrlf=true`)
- Release deploy zip ships the `.sh` alongside the `.bat`

**Security**
- Opt-in bearer-token wire auth

**Operator Guidance**
- New `backend-api/.env.example` — annotated template covering all provider keys (Groq / OpenAI / OpenRouter / Anthropic), optional Brave web-search, opt-in bearer auth, and network-mode bind. Operators `cp .env.example .env` and uncomment the line for the provider they have a key for.
- Missing-API-key warning at boot now points operators at `.env.example` and prints the exact `cp` + `nano` commands, so first-run setup on a clean Linux box is unambiguous

### Bug Fixes
- Pinned `requests` in `backend-api/requirements.txt` (used in `research_and_rank/web_generate_entity_profile.py`; was satisfied transitively on Windows operator venvs, broke first-boot on a clean Linux venv)
- `llm_ranking` no longer crashes on empty candidates / `None` content
- Duplicate trace emissions eliminated; `pipeline.json` defaults wired everywhere
- `REQUIRES_SESSION` narrowed to fuzzy/token nodes only
- Restored `name` field to `pipeline.json` and defined it in spec
- Removed unused `batch_overrides` from pipeline config
- Web search warning emission fixed alongside partial-pipeline caching

### BREAKING Changes
- **Consumer-visible: `llm_only` no longer substitutes reasoning trace as content** when a Groq/OpenAI reasoning model returns empty `message.content`. Returns `content=""` and emits a single neutral advisory of the form `content_empty: finish_reason={fr} reasoning_chars={N}` in `diagnostics.warnings`. The classifier on the consumer side derives fatality from advisory + raw shape (`step_tokens.llm_only.finish_reason` + `reasoning`), not by string-matching the warning code. Replaces the previous `empty_content_reasoning_fallback` warning that doubled as a substitution marker. Wire-format break is the substitution removal; the rename is additive.
- **Internal: `override_map` removed.** Pipeline params are nested-only; `node_overrides` / `node_config` is the sole route for per-node overrides.

### Technical Details
- 70 commits since v1.0.5: 31 features, 15 fixes, 19 refactors, 4 docs, 1 chore
- Major architecture pass: dead module elimination (`standards_logger.py`, `responses.py`, `environment.py` inlined), service/UI boundary enforcement (state-actions, pipeline-config, batch dedup), god-function decomposition, canonical 6-field prompt form, node-coordinate registries with dependency validation, type hints + named constants throughout

## [1.0.5] - 2026-01-27

### Highlights

**Zero-Click Setup**
- New ON/OFF toggle switch for tracking control in dashboard
- Auto-load mappings when config file is loaded

**Direct Prompt Enhancements**
- "Include output column" checkbox adds context to prompts
- New `direct_prompt_context` config option for domain-specific context
- Fuzzy validation (0.75 threshold) validates LLM responses against known terms
- Candidate picker: select from fuzzy-matched suggestions when validation fails

**Backend Infrastructure**
- Schema Registry (`utils/schema_registry.py`) for versioned JSON schema management
- Schemas stored in `logs/schemas/` with version tracking
- Langfuse-compatible datasets endpoints

**UI/UX Improvements**
- Dynamic cache size indicator shows current cache count
- Resizable columns in Matching Journal and Processing Results tables
- Compact status bar with inline layout
- Ellipsis truncation for long cell values
- Improved error messages with actionable guidance

### Bug Fixes
- Fixed cell selection scrolling and highlighting
- Fixed status message consolidation during startup
- Prevented auto-expand of newly added Matching Journal rows
- Added toggle for Matching Journal clear controls
- Included start-server-py-LLMs.bat in release package
- Removed invalid RequestedWidth from manifest Action element

### Technical Details
- 32 commits since v1.0.4: 8 features, 7 fixes, 3 refactors, 8 docs
- Unified column_map config - removed redundant confidence_column_map
- Removed backward compatibility wrappers from settings-manager
- EULA and privacy policy added for App Store submission
- No breaking changes from v1.0.4

## [1.0.4] - 2025-12-15

### Highlights

**Matching Journal (formerly "Activity History")**
- Renamed view to "Matching Journal" for clarity
- Complete overhaul of history tracking and deduplication logic
- Fixed timestamp-sorted insertion: delayed API responses no longer appear as "newest" assignment
- Fixed trimming logic: now evicts oldest entries by timestamp (was incorrectly removing most recent)
- Added `web_search_status` to history entries: warning icon persists across page refreshes
- New history indicator (🕐N) with clickable popup showing all assignments for a source
- Popup highlights current assignment (★) and allows viewing details of any historical entry
- Consolidated score columns into single Scores column with relevance calculation

**Cell Selection Navigation**
- Fixed scrolling to outdated entries: now looks up by normalized source key
- Uses `sourceIndex` Map for O(1) case-insensitive lookup
- Correctly displays details for current target (from row's data-identifier)

**Thermometer Component**
- New progress/status indicator with two modes
- Setup wizard: Sequential steps (server→config→mappings→activate) with auto-progression
- Research pipeline: Toggleable steps (web search→LLM→scoring→LLM ranking)
- LLM ranking toggle allows skipping second LLM call for faster processing

**UI/UX Improvements**
- New Home tab with setup wizard and hero cover
- Professional navbar redesign with cleaner layout
- Settings groups with card-like appearance and subtle shadows
- Status bar made sticky, "Backend" renamed to "Py-Server"
- Bubble animation replacing hourglass loader
- Direct Prompt integrated into event pipeline with batch semantics

**DirectEdit Reliability**
- Fixed duplicate row bug: DirectEdit now uses stored source value from cell state
- Fallback to Excel read when cell state doesn't exist (previous sessions)
- USER_ACTION_CONFIDENCE constant ensures consistent 100% confidence for UserChoice/DirectEdit
- Guaranteed source key matching prevents spurious duplicates from whitespace/casing differences
- History entries stay synced with latest state values (confidence, method) when viewing older traces

**Performance**
- Removed Microsoft Fabric CSS dependency (100KB CDN eliminated)
- Migrated 24+ hardcoded colors to CSS token variables
- Consolidated 3 button systems to unified `btn-primary`/`btn-secondary`
- Frontend cache history limit increased from 50 to 999

### Bug Fixes
- Fixed double-nested details element causing duplicate collapse triangles
- Fixed status message alignment (now left-bound with badge styling)
- Fixed auto-progression jumping backward when events re-fire
- Fixed responsive navbar layout for narrow taskpanes
- Fixed relevance_score calculation from core_concept + spec scores

### Technical Details
- 48 commits since v1.0.3: 6 features, 15 refactors, 7 fixes, 4 docs
- Source normalization: trim + lowercase + collapse whitespace + Unicode NFC
- History entries now include: `{ timestamp, target, method, confidence, web_search_status }`
- `handleCellSelection` prioritizes source lookup over identifier lookup
- New experiments API endpoint for external eval/optimization servers
- Improved Python server setup UX for first-time users
- No breaking changes from v1.0.3

## [1.0.3] - 2025-12-08

### Highlights

**Direct-Prompt UI**
- New UI component for custom LLM inference and testing
- Send arbitrary prompts directly to backend LLM providers
- Batch logging support for prompt experimentation

**Langfuse-Compatible Logging System**
- Production logging with traces, observations, scores, and datasets
- Cache hits and fuzzy matches now logged for evaluation tracking
- DirectEdit corrections logged as ground truth for model improvement
- Datetime-prefixed IDs compatible with MLflow UI
- New `events.jsonl` format bridging MLflow, Langfuse, and future tooling (replaces deprecated `activity.jsonl`)

**Documentation Overhaul**
- First comprehensive cleanup pass (~90% refinement)
- Reorganized docs structure: INSTALLATION → SETUP-GUIDE → CONFIGURATION → TROUBLESHOOTING
- Simplified guides for non-technical users
- Langfuse data model specification (`LANGFUSE_DATA_MODEL.md`)

**Architecture Modernization**
- Event-driven architecture with pub/sub Event Bus
- Immutable State Store replacing scattered state mutations
- Domain layer extraction (Cache Matcher, Fuzzy Matcher)
- Comprehensive test coverage for core modules

**Code Quality**
- ~2,500 lines removed through DRY utilities and dead code cleanup
- Standardized file naming (kebab-case convention)
- Centralized hyperparameters in configuration files
- Simplified UI components (44-67% size reductions)

### Technical Details
- 94 commits since v1.0.2: 12 features, 45 refactors, 10 fixes, 15 docs
- No breaking changes from v1.0.2
- Configuration file format unchanged

## [1.0.2] - 2025-11-27

### Highlights

**User-Facing Improvements**
- Help icon with terminology legend explaining normalization concepts
- Confidence column output showing match quality (0-100 scale)
- Critical fix: Workbook-isolated cell state prevents data corruption across multiple workbooks
- Improved Python version auto-detection with clear error messaging

**Deployment & Infrastructure**
- Automated deployment package creation for GitHub releases
- Enhanced deployment documentation for IIS and M365 environments
- Improved UI path display for different deployment scenarios

**Code Quality**
- Unified design system implementation (reduced CSS by 218 lines)
- Refactored activity tracking services for better maintainability
- Multiple performance and stability improvements

### Technical Details
- 47 commits since v1.0.1: 9 features, 8 bug fixes, 24 refactoring improvements
- No breaking changes from v1.0.1
- Configuration file format unchanged

## [1.0.1] - 2025-11-16

### Key Improvements for Users

**Enterprise Deployment**
- Windows Server deployment with IIS (industry-standard approach for internal networks)
- Simplified deployment with automated scripts
- Comprehensive troubleshooting guides for IT administrators

**Performance & Reliability**
- Faster matching with per-user caching
- More reliable session-based architecture
- Better error handling and recovery

**User Experience**
- Professional loading animations (sandclock indicator)
- Smoother cell updates during normalization
- Better visual feedback throughout the application

**Enhanced Search Capabilities**
- Brave API integration for improved web research
- More reliable web scraping with fallback providers
- Better handling of search failures

**Improved Setup**
- Better virtual environment location (project directory instead of backend-api/)
- Auto-detect Python command (python or py)
- Automated server startup with diagnostics

**Documentation & Support**
- Inline troubleshooting in installation guide
- Step-by-step manual deployment instructions
- Clear Excel cache clearing procedures
- Architecture documentation for developers

### Technical Changes

**Architecture**
- Session-based architecture (replaced caching system)
- 8-phase maintainability refactor for session management
- Centralized warning badge system

**Development & Deployment**
- Script organization into subdirectories (build/, deployment/)
- Webpack config updates (config folder in build output)
- PowerShell quote escaping fixes in deployment scripts
- Ultra-optimized server startup script

**Code Quality**
- Replace template placeholders with TermNorm branding
- Remove obsolete development documentation
- Remove outdated API key authentication system

**Bug Fixes**
- Excel cache clearing for deployment updates
- Target cells immediate update during sequential normalization
- Documentation alignment with venv path changes
- Web scraping fallbacks and error handling

## [1.0.0] - 2025-11-12

Initial release with core functionality:
- Excel add-in for term normalization
- Backend API with LLM integration
- Fuzzy matching and caching
- Real-time cell tracking
- Configuration management
