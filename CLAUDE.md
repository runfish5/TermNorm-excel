# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Frontend:**
```bash
npm run dev-server          # Start dev server (https://localhost:3000)
npm run start               # Sideload in Excel
npm run build               # Production build (GitHub Pages default)
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
```

## Architecture

**Design Philosophy:** Hybrid caching architecture
- Frontend caches all mappings in memory (no backend database)
- Backend caches `TokenLookupMatcher` per user (hash-based invalidation)
- Service-based organization with pure functions (minimal OOP)
- Terms array sent with requests; backend caches to avoid rebuilding matcher

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
- **Per-User Caching**: `TokenLookupMatcher` cached per user, invalidated when terms change
- **Matching Pipeline**: Token filtering → Web research + LLM profiling → LLM ranking
- **Auth**: IP allowlist in `users.json` (hot-reloaded), no passwords/tokens

**Data Flow:**
```
Cell edit → onChanged event → Cached match check → Fuzzy match (local)
→ POST /research-and-match {query, terms[]} → Backend: TokenLookup + Web + LLM
→ ranked_candidates[] → Display UI + Write cell → Log activity
```

## Configuration

Single JSON file (`config/app.config.json`) with column mappings and reference files:
- **M365**: Drag-drop into task pane
- **Desktop**: Save to `config/app.config.json` + click Load Config

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

**Frontend:**
- Dev: `npm run dev-server` (localhost:3000)
- Prod: `npm run build` (GitHub Pages default) or set `DEPLOYMENT_URL` env var
- Desktop Excel: Build → Deploy `dist/` to IIS → Share `manifest.xml` via network → Add to Trust Center

**Backend:**
- Local: `uvicorn main:app --reload`
- Network: `uvicorn main:app --host 0.0.0.0 --port 8000`
- Production: Use process manager, configure firewall, set API keys, update `users.json` IPs
