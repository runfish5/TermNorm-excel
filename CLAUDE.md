# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Frontend:**
```bash
npm run dev-server          # Start dev server (https://localhost:3000)
npm run start               # Sideload in Excel
npm run build               # Production build (GitHub Pages default)
npm run build:iis           # IIS deployment build (shows server filesystem paths)
npm run build:m365          # M365 deployment build (drag-and-drop only UI)
npm run lint / lint:fix     # Code quality
npm run validate            # Validate manifest.xml
```

**Backend:**
```bash
start-server-py-LLMs.bat                                         # Automated setup (Windows)
python -m uvicorn main:app --reload                              # Local (127.0.0.1:8000)
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload  # Network

# Configuration
setx GROQ_API_KEY "your_key"              # Required for LLM features
# Edit backend-api/config/users.json       # IP-based auth (hot-reloaded)
# NOTE: Brave Search API requires credit card to set up (used for web research)
```

## Architecture

**Design Philosophy:** Session-based architecture
- Frontend caches all mappings in memory (no backend database)
- Backend stores terms in user sessions (initialized when mappings load)
- Service-based organization with pure functions (minimal OOP)
- Lightweight requests after initial session setup

### Frontend Structure (Excel Add-in)

```
src/
├── taskpane/                         # Application orchestrator
│   └── taskpane.js                   # Entry point, initializes all systems
│
├── services/                         # Core business logic
│   ├── live.tracker.js               # Multi-workbook cell change monitoring
│   ├── normalizer.functions.js      # Normalization pipeline (cached → fuzzy → LLM)
│   └── normalizer.fuzzy.js          # String similarity algorithms
│
├── shared-services/                  # Global state management
│   └── state-machine.manager.js     # Frontend-only state (mappings, config, server status)
│
├── ui-components/                    # UI component functions
│   ├── ActivityFeedUI.js            # Processing history display
│   ├── CandidateRankingUI.js        # Ranked results UI
│   ├── mapping-config-functions.js  # Configuration UI
│   ├── file-handling.js             # Drag-drop config loading
│   └── view-manager.js              # Tab navigation
│
└── utils/                            # Helper utilities
    ├── api-fetch.js                  # Centralized API communication
    ├── server-utilities.js           # Server connection management
    ├── error-display.js              # User messaging system
    ├── cell-utilities.js             # Excel cell operations
    └── column-utilities.js           # Excel column mapping
```

**Key Patterns:**
- **Cell Tracking**: One tracker per workbook via `worksheet.onChanged` event (`live.tracker.js`)
- **Normalization Pipeline**: Three-tier fallback → Exact cache → Fuzzy → LLM (`normalizer.functions.js`)
- **State Management**: Single `appState` object with observer pattern, no backend sync (`state-machine.manager.js`)

### Backend Structure (FastAPI)

```
backend-api/
├── main.py                           # FastAPI app initialization + routers
│
├── api/                              # API endpoints
│   ├── system.py                     # /health, /log-activity, /test-connection
│   └── research_pipeline.py          # /research-and-match (core matching logic)
│
├── core/                             # Application core
│   ├── llm_providers.py              # LLM configuration (Groq/OpenAI)
│   ├── user_manager.py               # IP-based authentication
│   └── logging.py                    # Logging setup
│
├── config/                           # Configuration
│   ├── users.json                    # User IP allowlist (hot-reloaded)
│   ├── middleware.py                 # CORS + auth middleware
│   └── settings.py                   # App settings
│
└── research_and_rank/                # Matching algorithms
    ├── web_generate_entity_profile.py   # Web research + LLM profiling
    ├── call_llm_for_ranking.py          # LLM-based candidate ranking
    └── display_profile.py               # Profile formatting
```

**Key Concepts:**
- **Session Storage**: User sessions store terms array (initialized when mappings load)
- **Matching Pipeline**: Token filtering → Web research + LLM profiling → LLM ranking
- **Auth**: IP allowlist in `users.json` (hot-reloaded), no passwords/tokens

**Data Flow:**
```
Config load → POST /session/init-terms {terms[]} → Backend stores in session
Cell edit → onChanged event → Cached match check → Fuzzy match (local)
→ POST /research-and-match {query} → Backend retrieves terms from session
→ TokenLookup + Web + LLM → ranked_candidates[] → Display UI + Write cell
```

### Match Result Schema (Standardized)

All match methods return consistent data structure for reliable indexing and logging:

**Core Fields (All Methods):**
```javascript
{
  source: string,      // Original input value (normalized)
  target: string,      // Matched identifier/term
  method: string,      // "cached" | "fuzzy" | "ProfileRank"
  confidence: number,  // 0.0 - 1.0 match quality score
  timestamp: string    // ISO 8601 timestamp
}
```

**Additional Fields (LLM only):**
```javascript
{
  candidates: [...],           // All ranked candidates
  entity_profile: {...},       // Web research + LLM profile
  web_sources: [...],          // URLs used for profiling
  total_time: number,          // Processing time (ms)
  llm_provider: string,        // "groq/llama-3.3-70b-versatile"
  web_search_status: string    // "success" | "failed"
}
```

**Backend Logging:**
- All logs written to `logs/activity.jsonl` in normalized schema
- `/log-activity` endpoint validates and standardizes entries
- Consistent `source`/`target`/`timestamp` fields enable aggregation by target identifier
- Foundation for reference database: Group logs by `target` → deduplicate entity profiles

**Reference Database Architecture (Prepared):**
- Current: Each match logged separately (duplicates entity data)
- Future: Aggregate by `target` → Single reference entry per unique identifier
- Frontend: Store cell→target index (lightweight), fetch full details on-demand
- Memory efficient: 50 unique targets × 5KB = 250KB vs. 1000 cells × 5KB = 5MB

## Configuration

Single JSON file (`config/app.config.json`) with column mappings and reference files:
- **M365**: Drag-drop into task pane
- **Desktop**: Save to `config/app.config.json` + click Load Config

**Configuration Options:**
- `column_map`: Maps input columns to output columns (required)
- `confidence_column_map`: Maps input columns to confidence output columns (optional)
  - Confidence values are written as integers (0-100)
  - Enables sorting by match quality
  - Example: `"ana": "ana_confidence"` writes confidence scores to the `ana_confidence` column
- `default_std_suffix`: Suffix for auto-generated output columns
- `standard_mappings`: Reference file configurations

**Example Config:**
```json
{
  "column_map": {
    "InputColumn": "OutputColumn"
  },
  "confidence_column_map": {
    "InputColumn": "ConfidenceColumn"
  }
}
```

Config parsed in `mapping.processor.js`, reference files read via Office.js, mappings cached in frontend memory (no backend sync).

## Development

**Adding Features:**
1. Identify layer: UI component, service, or utility
2. Prefer pure functions over stateful modules
3. Update state via `state-machine.manager.js` if needed
4. Test in both Desktop and M365 Excel

**Debugging:**
- Frontend: F12 DevTools, `console.log()`, `error-display.js`
- Backend: uvicorn console, `backend-api/logs/app.log`, `/health` endpoint

**Important:**
- All Excel operations must be inside `Excel.run()` (async/await)
- Use `\\` in JSON paths
- Add your IP to `backend-api/config/users.json` for auth

## Deployment

### Deployment Types & Configuration

The add-in supports three deployment scenarios with different UI behaviors:

**1. Development (default)**
- Build: `npm run build` or `npm run dev-server`
- Shows local development paths for config files
- Users see instructions to edit `app.config.json` directly

**2. IIS Server Deployment**
- Build: `npm run build:iis` or set `DEPLOYMENT_TYPE=iis` before build
- Shows server filesystem paths (e.g., `C:\inetpub\wwwroot\termnorm`)
- UI indicates "IIS Server" deployment
- Supports both admin filesystem access and drag-and-drop config loading
- Set `DEPLOYMENT_PATH` env var to customize displayed path:
  ```bash
  set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm
  set DEPLOYMENT_TYPE=iis
  npm run build
  ```

**3. Microsoft 365 Deployment**
- Build: `npm run build:m365` or set `DEPLOYMENT_TYPE=m365` before build
- Hides filesystem paths (no server access)
- Shows drag-and-drop instructions only
- UI indicates "Microsoft 365" deployment

### Environment Variables

**DEPLOYMENT_URL** (existing)
- Controls the base URL in manifest.xml
- Default: `https://runfish5.github.io/TermNorm-excel/`
- Example: `set DEPLOYMENT_URL=https://localhost:8443/termnorm/`

**DEPLOYMENT_TYPE** (new)
- Controls UI path display behavior
- Values: `development` (default), `iis`, `m365`
- Example: `set DEPLOYMENT_TYPE=iis`

**DEPLOYMENT_PATH** (new)
- Filesystem path shown to users for config file location
- Default: Build directory path
- Only relevant for `development` and `iis` types
- Example: `set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm`

### Deployment Workflows

**Frontend:**
- Dev: `npm run dev-server` (localhost:3000)
- GitHub Pages: `npm run build` (default DEPLOYMENT_URL)
- IIS Server:
  ```bash
  set DEPLOYMENT_TYPE=iis
  set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm
  npm run build:iis
  # Copy dist/ folder to IIS server
  ```
- M365: `npm run build:m365` (drag-and-drop only)
- Desktop Excel: Build → Deploy `dist/` to IIS → Share `manifest.xml` via network → Add to Trust Center

**Backend:**
- Local: `uvicorn main:app --reload`
- Network: `uvicorn main:app --host 0.0.0.0 --port 8000`
- Production: Use process manager, configure firewall, set API keys, update `users.json` IPs
