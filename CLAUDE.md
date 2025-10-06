# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TermNorm is an Excel add-in that provides real-time terminology normalization using AI-powered matching. It consists of two main components:

1. **Frontend**: Office JavaScript add-in built with Webpack, deployed as a task pane in Excel
2. **Backend**: Python FastAPI server that handles LLM processing, fuzzy matching, and term standardization

The add-in monitors Excel cells in real-time, applies configurable mapping rules, and provides AI-powered term suggestions through integration with LLM providers (Groq/OpenAI).

## Development Commands

### Backend (Python API)
Navigate to `backend-api/` directory first:
- `.\venv\Scripts\activate` - Activate Python virtual environment
- `python -m uvicorn main:app --reload` - Start development server (localhost:8000)
- `python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload` - Start network server
- Configure user IPs in `config/users.json` for authentication

## Architecture

### Frontend Architecture: Service-Based Design

**Core Application Layer**
- `taskpane/taskpane.js` - Application orchestrator coordinating services
- `shared-services/state-machine.manager.js` - State manager with frontend caching

**Service Layer: Business Logic**
- `services/live.tracker.js` - Multi-workbook cell monitoring with isolated trackers
- `services/normalizer.functions.js` - Term normalization pipeline (exact → fuzzy → LLM)
- `services/normalizer.fuzzy.js` - Fuzzy matching algorithms

**UI Layer: Component Functions**
- `ui-components/` - UI component functions (DOM manipulation)
- `ui-components/view-manager.js` - View switching logic
- `ui-components/file-handling.js` - Drag & drop configuration loading
- `ui-components/mapping-config-functions.js` - Mapping table UI management

**Utility Layer: Helper Functions**
- `utils/api-fetch.js` - Centralized API communication wrapper (all fetch() calls)
- `utils/error-display.js` - Centralized error/status UI updates
- `utils/server-utilities.js` - Server connection and status
- `utils/column-utilities.js` - Column mapping and validation
- `utils/cell-utilities.js` - Cell value processing and change detection
- `utils/activity-logger.js` - Session logging
- `utils/app-utilities.js` - Application utilities (UI layout, Excel integration, color management)

**Data Processing Layer**
- `data-processing/mapping.processor.js` - Excel data loading and mapping processing

### Backend Structure - Ultra-lean Architecture
```
backend-api/
├── main.py                    # FastAPI application with 3 routers + lifespan management
├── config/                    # Centralized configuration and middleware
│   ├── users.json            # User authentication with IP-based access control
│   ├── middleware.py         # IP authentication middleware
│   └── settings.py           # Application settings
├── api/                       # API endpoints
│   ├── system.py             # Health checks and activity logging
│   ├── research_pipeline.py  # /research-and-match endpoint (core pipeline)
│   └── matcher_setup.py      # /update-matcher, /session-state endpoints (per-user, per-project)
├── core/                      # Core functionality
│   ├── user_manager.py       # Multi-user session management with per-project isolation
│   ├── llm_providers.py      # LLM provider configuration
│   └── logging.py            # Logging setup
├── research_and_rank/         # Research and ranking implementation
│   ├── web_generate_entity_profile.py
│   ├── display_profile.py
│   ├── call_llm_for_ranking.py
│   └── correct_candidate_strings.py
└── utils/                     # Utility functions
    ├── utils.py              # Helper functions and color constants
    └── responses.py          # Standardized API response format
```

### Key Integration Points

**Central Orchestration**: `taskpane.js` serves as the main application coordinator, with configuration loading now extracted to `config-processor.js` pure functions and file handling modularized in `file-handling.js`.

**State Management**: Frontend caches mappings for fast exact/fuzzy matching. Backend stores TokenLookupMatcher for LLM research. Simple loading states: idle → loading → synced | error.

**Frontend/Backend Session Sync**:
- Frontend tracks backend session state (`state.backend.sessionExists`)
- Health checks performed before major actions (tracking activation, LLM calls)
- Backend sessions expire after 24h TTL - user must reload mappings when expired
- `state.server.online` updated on every API call for real-time server status
- Graceful degradation: Exact/fuzzy matching works offline, LLM requires backend session

**Configuration System**: Project configurations are processed using pure functions in `config-processor.js` for validation and workbook selection, with drag & drop handling in `file-handling.js`. Configurations define:
- Column mappings (input → output columns)
- Reference file paths and worksheet specifications
- Standard mapping sources

**Cell Monitoring**: Live tracking functions (`startTracking()`, `stopTracking()`) monitor Excel worksheet changes and trigger normalization using pure functions from `normalizer.functions.js`.

**API Communication**: All backend communication flows through `api-fetch.js` wrapper (`apiFetch()`, `apiPost()`, `apiGet()`). This centralizes fetch calls, JSON parsing, error handling, and LED updates. Authentication is IP-based via `users.json` with hot-reload. Each workbook gets isolated matcher - session keys use format `{user_id}:{workbook_name}`. Multiple workbooks can be open simultaneously without term conflation.

**Error Handling**: Centralized error display via `error-display.js`. Network errors (server offline) handled in `api-fetch.js` catch block. HTTP errors use ERROR_MAP for frontend overrides (403, 503) or backend messages for other codes. Backend returns standardized format: `{status: "success|error", message: "...", data: {...}}` via `responses.py` utilities. Custom HTTPException handler in `main.py` ensures consistent error format.

## Architecture Principles

**Service-Based Design**: Business logic organized into service modules with clear responsibilities.

**Direct State Access**: State accessed via `state.server.online` for simplicity. No getters/setters unless needed.

**Minimal Abstraction**: Direct function calls (`getHost()`) instead of object wrappers. Add abstraction only when multiple implementations exist.

**Central Coordination**: `taskpane.js` orchestrates services while delegating specialized work to dedicated modules.

**Pragmatic Approach**: Code is practical and functional. Prioritize working solutions over architectural purity.

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
User Selection (Apply term → update target column)
    ↓
Logging (activity.jsonl + state update)
```

## Configuration Requirements

The add-in requires an `app.config.json` file in the `config/` directory with this structure:
```json
{
  "excel-projects": {
    "WorkbookName.xlsx": {
      "column_map": {
        "input_column": "output_column"
      },
      "standard_mappings": [{
        "mapping_reference": "path/to/reference.xlsx",
        "worksheet": "SheetName",
        "source_column": "SourceCol",
        "target_column": "TargetCol"
      }]
    }
  }
}
```

## Environment Setup

1. **Multi-User Setup**: Configure `backend-api/config/users.json` with user IDs, emails, and allowed IPs. Hot-reload supported - no restart needed when adding users.
2. **LLM Provider**: Configure Groq or OpenAI API keys in backend environment variables for research-and-match functionality
3. **Development Certificates**: Office add-in requires HTTPS certificates (handled by office-addin-dev-certs)
4. **Python Environment**: Backend requires Python virtual environment with FastAPI dependencies

## Multi-User & Per-Project Architecture

**Authentication**: IP-based authentication via `config/users.json`. No frontend API keys required. Users identified by IP address with hot-reload capability.

**Session Management**:
- Per-user, per-project isolation using tuple keys: `(user_id, project_id)`
- Project ID derived from workbook name (e.g., "Book 76", "Excel add-in xyz.xlsx")
- Each workbook gets its own TokenLookupMatcher instance on backend
- Each workbook gets isolated tracker instance on frontend
- TTL-based session expiration (24 hours default) with lazy cleanup on access
- Sessions auto-expire after inactivity - no scheduled cleanup tasks needed

**State Management**:
- Frontend caches mappings in memory for instant exact/fuzzy matching
- Backend stores TokenLookupMatcher for expensive LLM research calls
- Simple states: idle → loading → synced | error
- Health check on first load verifies backend session exists
- No periodic reconciliation - frontend cache and backend serve different purposes
- Multi-workbook support via isolated tracker instances per workbook

**Example Session Keys**:
- User "admin" with "Book 76" → `admin:Book 76`
- User "john" with "DataSet.xlsx" → `john:DataSet.xlsx`
- Same user, different workbooks → separate isolated matchers

## Code Quality Standards

**Pragmatic Implementation**: Code prioritizes working solutions over architectural purity. Patterns are adopted when they solve actual problems, not for theoretical benefits.

**Clear Separation**: Frontend caches data for performance. Backend stores data for LLM processing. No attempt to "synchronize" - they serve different purposes.

**Maintainability**: Code is organized into focused modules with clear responsibilities. Complexity is added only when needed.

## Known Limitations

1. **Backend Session TTL**: Sessions expire after 24 hours. If Excel stays open longer, reload mappings to enable LLM research. Exact/fuzzy matching continues to work.

2. **Manual Session Recovery**: When backend session expires, user must manually reload mappings. No automatic session recreation.

3. **State Deep Clone**: `getState()` uses `JSON.parse(JSON.stringify())` for deep cloning. Functions and special objects (Date, Map, Set) are not preserved in the clone.

4. **Health Check Latency**: Health checks called before tracking activation and LLM calls add ~100ms latency per check.

5. **Single Excel Instance Per Project**: Each Excel file runs its own add-in instance with isolated state. Opening the same file twice creates two independent instances.