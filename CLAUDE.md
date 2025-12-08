# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TermNorm is an AI-powered terminology normalization Excel add-in. It matches free-form text to standardized database identifiers using a three-tier approach: exact cache lookup → fuzzy matching → LLM research with web scraping.

**Architecture**: Vanilla JavaScript frontend (Office.js) + Python FastAPI backend

## Common Commands

### Frontend Development
```bash
npm run dev-server          # Start webpack dev server (port 3000)
npm run build               # Production build
npm run build:iis           # Build for IIS deployment
npm run build:m365          # Build for Microsoft 365
npm test                    # Run Jest tests
npm run test:watch          # Watch mode
npm run test:coverage       # Generate coverage report
npm run lint                # Check with ESLint
npm run lint:fix            # Auto-fix lint issues
npm run start               # Debug in Excel desktop (F5 in VS Code)
npm run validate            # Validate manifest.xml
```

### Backend Development
```bash
cd backend-api
python -m venv .venv
.\.venv\Scripts\activate    # Windows
pip install -r requirements.txt
python -m uvicorn main:app --reload                              # Local dev
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload  # Network
```

Or use `start-server-py-LLMs.bat` for one-click startup.

## Architecture

### Frontend (src/)
- **core/**: Event-driven state management
  - `state-store.js` - Immutable state container with subscriber pattern
  - `event-bus.js` - Pub/sub event system for loose coupling
  - `events.js` - Event type definitions
  - `state-actions.js` - Centralized state mutations
- **services/**: Business logic and data processing
  - `live-tracker.js` - Excel cell change tracking per workbook
  - `normalizer.js` - Three-tier matching pipeline
  - `state-manager.js` - Mappings, sessions, and settings management
  - `session-recovery.js` - Backend session initialization
  - `mapping-processor.js` - Excel mapping file processor
- **matchers/**: Matching algorithms
  - `cache-matcher.js` - Exact match lookup
  - `fuzzy-matcher.js` - Similarity matching (thresholds: forward 0.7, reverse 0.5)
- **taskpane/**: Main entry point (`taskpane.js` - Office.onReady initialization)
- **ui-components/**: Reusable UI modules (batch-processing, candidate-ranking, etc.)
- **utils/**: Helpers (api-fetch, server-utilities, status-indicators, etc.)
- **config/**: Configuration constants (normalization.config.js, session.config.js)
- **design-system/**: CSS tokens and component styles

### Backend (backend-api/)
- **main.py**: FastAPI app entry point
- **api/**: Route handlers
  - `research_pipeline.py` - `/research-and-match` endpoint (core pipeline)
  - `system.py` - Health checks, LLM config, cache management
- **core/**: Infrastructure
  - `llm_providers.py` - Unified Groq/OpenAI interface with retry logic
- **research_and_rank/**: AI pipeline modules
  - `web_generate_entity_profile.py` - Web scraping + entity extraction
  - `call_llm_for_ranking.py` - LLM candidate ranking
  - `correct_candidate_strings.py` - Fuzzy correction of LLM outputs
- **utils/**:
  - `langfuse_logger.py` - Langfuse-compatible trace/observation/score/dataset logging
  - `live_experiment_logger.py` - High-level logging functions (`log_to_langfuse`, `log_user_correction`)
  - `prompt_registry.py` - Versioned prompt management
- **config/**: Settings, middleware, users.json (hot-reload)
- **logs/**: Runtime data
  - `match_database.json` - Persistent match cache
  - `langfuse/` - Langfuse-compatible logging (traces, observations, scores, datasets)
  - `prompts/` - Versioned LLM prompts

### Web Search
Brave API → SearXNG → DuckDuckGo → Bing fallback chain.
Toggle via `USE_BRAVE_API=true/false` in `.env`. Get key: https://api-dashboard.search.brave.com/register

### Key Patterns
1. **Event-Driven UI**: Components react to events from event-bus (MAPPINGS_LOADED, CANDIDATES_AVAILABLE, etc.)
2. **Unified State Store**: All state lives in `state-store.js`
   - Cell state: `session.workbooks[workbookId].cells[cellKey]`
   - Mutations via `state-actions.js` functions
3. **Session-Based**: No database - in-memory state with JSON persistence
4. **Three-Tier Matching**: Cache → Fuzzy → LLM (auto-apply threshold: confidence > 0.9)
5. **Workbook-Scoped Tracking**: Multiple workbooks track cells independently
6. **IP-Based Auth**: Users configured in `backend-api/config/users.json`
7. **Office.js Operations**: Batch inside `Excel.run(async (ctx) => {...})`, commit with `ctx.sync()`
8. **$ Helper Pattern**: DOM queries via `const $ = id => document.getElementById(id)`

## Code Quality Standards

**Maintainability**: Code is organized into focused modules with clear responsibilities. Complexity is added only when needed.

**Direct State Access**: State accessed via `state.server.online` for simplicity. No getters/setters unless needed.

**Central Coordination**: `taskpane.js` orchestrates services while delegating specialized work to dedicated modules.

Widget components (small, reusable UI elements like status indicators) are grouped separately from full-view containers (entire screens/panels).

## Configuration Files

- `manifest.xml` - Development manifest (localhost:3000)
- `manifest-iis.xml` - IIS/network deployment
- `manifest-cloud.xml` - Microsoft 365 deployment
- `config/app.config.json` - Frontend runtime config (backend URL, column mappings)
- `backend-api/.env` - Environment variables (API keys)
- `backend-api/config/users.json` - IP-based user authentication (hot-reload)

### app.config.json Structure
```json
{
  "backend_url": "http://127.0.0.1:8000",
  "excel-projects": {
    "Workbook.xlsx": {
      "column_map": { "InputColumn": "OutputColumn" },
      "confidence_column_map": { "InputColumn": "ConfidenceColumn" },
      "default_std_suffix": "standardized",
      "standard_mappings": [{
        "mapping_reference": "C:\\path\\to\\reference.xlsx",
        "worksheet": "Sheet1",
        "source_column": "SourceCol",
        "target_column": "TargetCol"
      }]
    }
  }
}
```

## Testing

Frontend tests are in `__tests__/` directories adjacent to source files:
- `src/core/__tests__/` - State store and event bus tests

Run a single test file:
```bash
npm test -- src/core/__tests__/state-store.test.js
```

## Data Flow

## Event Task Flowchart

The TermNorm add-in follows a structured event-driven workflow:

```
App Initialization
    ↓
Configuration Loading (Drag & Drop or filesystem)
    ↓
Server Setup (backend-api venv + FastAPI on localhost:8000)
    ↓
Mapping Processing (Load reference files + validate column mappings)
    ↓
Activate Live Tracking (Monitor worksheet changes)
    ↓
[User Input: Cell Entry + Enter]
    ↓
Normalization Pipeline
    ├─ 1. Quick lookup (cached)
    ├─ 2. Fuzzy matching
    └─ 3. LLM research (/research-and-match API)
    ↓
Results Display (Ranked candidates + status indicators)
    ↓
Optional: User Selection (Apply term → update target column)
    ↓
Logging
```

## Langfuse-Compatible Logging

Backend logs to `logs/langfuse/` in Langfuse-compatible format:

```
logs/langfuse/
├── traces/                    # Lean trace files (~10 lines)
├── observations/{trace_id}/   # Verbose step details (separate files)
├── scores/                    # Evaluation metrics
└── datasets/                  # Ground truth items
```

Key concepts:
- **Traces**: Lean workflow summaries (input/output only)
- **Observations**: Verbose step data in separate files (web_search, entity_profiling, etc.)
- **Dataset Items**: Ground truth with `source_trace_id` linking TO traces
- **UserChoice/DirectEdit**: Updates dataset item's `expected_output`

Trace IDs use datetime-prefixed format: `YYMMDDHHMMSSxxxxxxxx...`

See `backend-api/docs/LANGFUSE_DATA_MODEL.md` for full specification.

## Known Limitations

1. **Single Excel Instance Per Project**: Each Excel file runs its own add-in instance with isolated state. Opening the same file twice creates two independent instances.
