# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TermNorm is an Excel add-in that provides real-time terminology normalization using AI-powered matching. It consists of two main components:

1. **Frontend**: Office JavaScript add-in built with Webpack, deployed as a task pane in Excel
2. **Backend**: Python FastAPI server that handles LLM processing, fuzzy matching, and term standardization

The add-in monitors Excel cells in real-time, applies configurable mapping rules, and provides AI-powered term suggestions through integration with LLM providers (Groq/OpenAI).

## Client Distribution Strategy

**Version Control:** `master` branch is for development (unstable). Clients receive email notifications with specific release links (e.g. v1.0.0) from https://github.com/runfish5/TermNorm-excel/releases. Release branches (`release/v1.x.x`) are immutable and stable. Only create releases from tested, stable code.

## Development Commands

### Backend (Python API)
**Recommended**: Double-click `start-server-py-LLMs.bat` in the project root for automated setup.

**Manual commands** (navigate to `backend-api/` directory first):
- `.\.venv\Scripts\activate` - Activate Python virtual environment
- `python -m uvicorn main:app --reload` - Start development server (localhost:8000)
- `python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload` - Start network server
- Configure user IPs in `config/users.json` for authentication (hot-reload enabled)

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
- `utils/error-display.js` - Centralized message display via `showMessage(text, type)`
- `utils/led-indicator.js` - Server status LED indicator (setup, updates, click handlers)
- `utils/matcher-indicator.js` - Matcher status dashboard (forward/reverse counts, capabilities)
- `utils/offline-warning.js` - Offline mode warning visibility management
- `utils/settings-manager.js` - Settings persistence via localStorage
- `utils/server-utilities.js` - Server connection and status (promise-based checking, direct fetch for health)
- `utils/column-utilities.js` - Column mapping and validation
- `utils/cell-utilities.js` - Cell value processing and change detection
- `utils/activity-logger.js` - Session logging
- `utils/app-utilities.js` - Application utilities (UI layout, Excel integration, color management)

**Data Processing Layer**
- `data-processing/mapping.processor.js` - Excel data loading and mapping processing

### Backend Structure - Stateless Architecture
```
backend-api/
├── main.py                    # FastAPI application with 2 routers + lifespan management
├── config/                    # Centralized configuration and middleware
│   ├── users.json            # User authentication with IP-based access control
│   ├── middleware.py         # IP authentication middleware
│   └── settings.py           # Application settings
├── api/                       # API endpoints
│   ├── system.py             # Health checks and activity logging
│   └── research_pipeline.py  # /research-and-match endpoint (stateless - creates matcher on-the-fly)
├── core/                      # Core functionality
│   ├── user_manager.py       # IP-based authentication (no session management)
│   ├── llm_providers.py      # LLM provider configuration
│   └── logging.py            # Logging setup
├── research_and_rank/         # Research and ranking implementation
│   ├── web_generate_entity_profile.py  # 4-tier search: Brave API → SearXNG → DDG → Bing
│   ├── display_profile.py
│   ├── call_llm_for_ranking.py
│   └── correct_candidate_strings.py
└── utils/                     # Utility functions
    ├── utils.py              # Helper functions and color constants
    └── responses.py          # Standardized API response format
```

### Key Integration Points

**Central Orchestration**: `taskpane.js` serves as the main application coordinator, with configuration loading and file handling modularized in `file-handling.js`.

**State Management (Frontend Only)**: Frontend is the single source of truth for mappings. State stored in `state.mappings.combined` for fast exact/fuzzy matching. Simple loading states: idle → loading → synced | error. Backend is stateless - no sessions, no TTL, no synchronization complexity.

**Stateless Backend Architecture**:
- Backend receives terms array with each `/research-and-match` request
- Creates `TokenLookupMatcher` on-the-fly per request, uses it, discards it
- Zero session management = zero TTL tracking = zero health checks
- Pure function architecture: `(query, terms) → ranked_candidates`
- Each request is independent and self-contained

**Configuration System**: Project configurations are validated inline in `file-handling.js` with drag & drop support. Configurations define:
- Column mappings (input → output columns)
- Reference file paths and worksheet specifications
- Standard mapping sources

**Cell Monitoring**: Live tracking functions (`startTracking()`, `stopTracking()`) monitor Excel worksheet changes and trigger normalization using pure functions from `normalizer.functions.js`. Concurrent activation attempts are prevented via guard in `startTracking()` to avoid duplicate event handlers.

**API Communication**: All backend communication flows through `api-fetch.js` wrapper (`apiFetch()`, `apiPost()`, `apiGet()`). This centralizes fetch calls, JSON parsing, and error handling. Authentication is IP-based via `users.json` with hot-reload. Server status checks use direct `fetch()` to avoid UI message pollution and are promise-based - concurrent checks wait for the same promise to avoid stale status data.

**UI Status Updates**: Status messages handled by `error-display.js` via single `showMessage(text, type)` function. LED indicator managed separately by `led-indicator.js` (`updateLED()`, `setupLED()`). Offline mode warning handled by `offline-warning.js` (`updateOfflineModeWarning()`). Matcher status dashboard in `matcher-indicator.js` shows forward/reverse term counts with clickable details. Network errors (server offline) handled in `api-fetch.js` catch block. HTTP errors use ERROR_MAP for frontend overrides (403, 503) or backend messages for other codes. Backend returns standardized format: `{status: "success|error", message: "...", data: {...}}` via `responses.py` utilities. Custom HTTPException handler in `main.py` ensures consistent error format.

## Architecture Principles

**Service-Based Design**: Business logic organized into service modules with clear responsibilities.

**Direct State Access**: State accessed via `state.server.online` for simplicity. No getters/setters unless needed.

**Minimal Abstraction**: Direct function calls (`getHost()`) instead of object wrappers. Add abstraction only when multiple implementations exist.

**Central Coordination**: `taskpane.js` orchestrates services while delegating specialized work to dedicated modules.

**Pragmatic Approach**: Code is practical and functional. Prioritize working solutions over architectural purity.

**CSS Organization**: Styles are separated by scope:
- `taskpane.css` (456 lines) - Global layout, navigation, buttons, forms, and core app structure
- `status-bar-widgets.css` (223 lines) - Reusable status bar widgets (loading indicator, LED, matcher indicator, offline warning)
- `ActivityFeedUI.css`, `CandidateRankingUI.css`, `mapping-config-modules.css` - Full-view container components

Widget components (small, reusable UI elements like status indicators) are grouped separately from full-view containers (entire screens/panels).

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
3. **Web Search Configuration**:
   - **Brave Search API (Optional)**: Configure `BRAVE_SEARCH_API_KEY` in `.env` for reliable web search (2k free queries/month). Get key at: https://api-dashboard.search.brave.com/register
   - **Brave API Toggle**: Control via `USE_BRAVE_API=true/false` in `.env` (default: true) or toggle in Settings UI under "Processing Options"
   - **Fallback Chain**: When Brave disabled/unconfigured, system uses: SearXNG → DuckDuckGo → Bing
   - **Testing Fallbacks**: Disable Brave API toggle in Settings to test fallback reliability without removing API key
4. **Development Certificates**: Office add-in requires HTTPS certificates (handled by office-addin-dev-certs)
5. **Python Environment**: Backend requires Python virtual environment with FastAPI dependencies

## Multi-User Architecture

**Authentication**: IP-based authentication via `config/users.json`. No frontend API keys required. Users identified by IP address with hot-reload capability.

**Stateless Backend**: No session management. Backend is a pure compute service:
- Each `/research-and-match` request receives `{query, terms}` payload
- Creates `TokenLookupMatcher` on-the-fly, uses it, discards it
- No persistent state = no TTL = no session expiration
- Multiple users can make concurrent requests without interference

**Frontend State Management**:
- Frontend caches mappings in `state.mappings.combined` for instant exact/fuzzy matching
- Each workbook gets isolated tracker instance on frontend
- Simple loading states: idle → loading → synced | error
- User loads mappings at session start - terms sent with each LLM request

## Code Quality Standards

**Pragmatic Implementation**: Code prioritizes working solutions over architectural purity. Patterns are adopted when they solve actual problems, not for theoretical benefits.

**Stateless Backend**: Backend has zero state management. Frontend is the single source of truth for mappings. This eliminates synchronization complexity entirely.

**Maintainability**: Code is organized into focused modules with clear responsibilities. Complexity is added only when needed.

## Known Limitations

1. **Single Excel Instance Per Project**: Each Excel file runs its own add-in instance with isolated state. Opening the same file twice creates two independent instances.

2. **LLM Request Payload Size**: Each LLM request sends full terms array (~50KB for 1000 terms). Trade-off: slightly larger payloads for zero state management complexity.