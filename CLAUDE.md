# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TermNorm is an AI-powered terminology normalization Excel add-in. It matches free-form text to standardized database identifiers using a three-tier approach: exact cache lookup → fuzzy matching → LLM research with web scraping.

**Architecture**: Vanilla JavaScript frontend (Office.js) + Python FastAPI backend

**Version**: 1.0.3

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
  - `events.js` - Event type definitions (MAPPINGS_LOADED, MATCH_LOGGED, etc.)
  - `state-actions.js` - Centralized state mutations (JSDoc typed)
- **services/**: Business logic and data processing
  - `live-tracker.js` - Excel cell change tracking, emits MATCH_LOGGED events
  - `normalizer.js` - Three-tier matching pipeline (JSDoc typed)
  - `workflows.js` - Async business logic: mappings, sessions, settings (JSDoc typed)
  - `mapping-processor.js` - Excel mapping file processor
- **matchers/**: Matching algorithms
  - `matchers.js` - Cache + fuzzy matching (thresholds: forward 0.7, reverse 0.5) (JSDoc typed)
- **taskpane/**: Main entry point (`taskpane.js` - Office.onReady, wizard state machine)
- **ui-components/**: Reusable UI modules
  - `thermometer.js` - Progress/status indicator with two modes
  - `candidate-ranking.js` - Drag-to-rank candidate selection
  - `processing-history.js` - Matching Journal view, listens for MATCH_LOGGED events
  - `direct-prompt.js` - Custom LLM inference UI
  - `file-handling.js` - Config file drag-and-drop
  - `mapping-config.js` - Mapping configuration panel
  - `settings-panel.js` - Settings UI
- **utils/**: DOM and API helpers
  - `api-fetch.js` - Backend API client + server utilities (JSDoc typed)
  - `dom-helpers.js` - `$()`, `showView()`, modal helpers
  - `column-utilities.js` - Column mapping builders (JSDoc typed)
  - `error-display.js` - User-facing status messages
  - `settings-manager.js` - Persistent settings storage
  - `status-indicators.js` - LED indicators and status updates
  - `app-utilities.js` - Version display, relevance colors
  - `history-cache.js` - Processing history cache
- **config/**: Configuration constants
  - `config.js` - All constants, thresholds, JSDoc typedefs (MatchResult, CellState, MappingData)
- **design-system/**: CSS architecture
  - `tokens.css` - Color, spacing, typography variables
  - `utilities.css` - Utility classes (hidden, flex, etc.)
  - `components.css` - Badges, cards, buttons, forms

### Backend (backend-api/)
- **main.py**: FastAPI app entry point
- **api/**: Route handlers (RESTful endpoints)
  - `research_pipeline.py` - `/sessions`, `/matches`, `/batches`, `/prompts`, `/activities`
  - `system.py` - `/health`, `/settings`, `/history`, `/cache`
  - `experiments_api.py` - `/experiments/*` for eval/optimization integration
- **core/**: Infrastructure
  - `llm_providers.py` - Unified Groq/OpenAI interface with retry logic
  - `logging.py` - Backend logging configuration
  - `user_manager.py` - IP-based user authentication
- **research_and_rank/**: AI pipeline modules
  - `web_generate_entity_profile.py` - Web scraping + entity extraction
  - `call_llm_for_ranking.py` - LLM candidate ranking
  - `correct_candidate_strings.py` - Fuzzy correction of LLM outputs
  - `display_profile.py` - Entity profile formatting
- **utils/**:
  - `langfuse_logger.py` - Langfuse-compatible logging
  - `prompt_registry.py` - Versioned prompt management
  - `standards_logger.py` - Experiment/run management
  - `cache_metadata.py` - Cache metadata tracking
  - `responses.py` - API response formatting
  - `utils.py` - General utilities
- **config/**: Settings, middleware, users.json (hot-reload)
- **logs/**: Runtime data
  - `match_database.json` - Persistent match cache
  - `langfuse/` - Langfuse-compatible logging (traces, observations, scores, datasets)
  - `prompts/` - Versioned LLM prompts

### Web Search
Brave API → SearXNG → DuckDuckGo → Bing fallback chain.
Toggle via `USE_BRAVE_API=true/false` in `.env`. Get key: https://api-dashboard.search.brave.com/register

### Key Patterns
1. **Event-Driven UI**: Components react to events from event-bus (MAPPINGS_LOADED, CANDIDATES_AVAILABLE, MATCH_LOGGED)
2. **Service/UI Boundary**: Services emit events, UI listens. No direct imports from services→UI.
3. **Unified State Store**: All state lives in `state-store.js`
   - Cell state: `session.workbooks[workbookId].cells[cellKey]`
   - Mutations via `state-actions.js` functions
4. **Centralized Config**: All constants in `config/config.js` with JSDoc typedefs
5. **Session-Based**: No database - in-memory state with JSON persistence
6. **Three-Tier Matching**: Cache → Fuzzy → LLM (auto-apply threshold: confidence > 0.9)
7. **Workbook-Scoped Tracking**: Multiple workbooks track cells independently
8. **IP-Based Auth**: Users configured in `backend-api/config/users.json`
9. **Office.js Operations**: Batch inside `Excel.run(async (ctx) => {...})`, commit with `ctx.sync()`
10. **$ Helper Pattern**: DOM queries via `const $ = id => document.getElementById(id)`
11. **Thermometer Component**: Progress indicator with two modes:
    - `progress`: Sequential steps, collapsible, fill bar (setup wizard: server→config→mappings→activate)
    - `status`: Independent toggleable states (research pipeline: web→LLM→score→rank)

## Code Quality Standards

**Maintainability**: Code is organized into focused modules with clear responsibilities. Complexity is added only when needed.

**Direct State Access**: State accessed via `state.server.online` for simplicity. No getters/setters unless needed.

**Central Coordination**: `taskpane.js` orchestrates services while delegating specialized work to dedicated modules.

**Type Definitions**: Key functions have JSDoc types for IDE autocomplete. Shared types defined in `config/config.js`:
- `MatchResult` - Normalization result (target, method, confidence, candidates, etc.)
- `CellState` - Cell processing state (value, status, row, col, result)
- `MappingData` - Forward/reverse mappings with metadata

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
Logging (MATCH_LOGGED event → history + backend)
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
