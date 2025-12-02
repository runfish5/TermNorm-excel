# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TermNorm is an Excel add-in that performs AI-powered terminology normalization and database identifier assignment. It combines a JavaScript frontend (Office.js add-in) with a Python FastAPI backend to enable real-time intelligent matching of free-form text to standardized terminology through a three-tier architecture: exact cache lookup → fuzzy string matching → LLM-powered web research.

**Core Value Proposition:** Type in Excel → Get standardized results automatically. No database installation, drag-and-drop configuration, complete audit trail.

## Architecture

### Frontend (Office.js Add-in)
- **Framework:** Vanilla JavaScript + Office.js API + Webpack
- **Entry Point:** `src/taskpane/taskpane.js` - Main initialization and setup
- **State Management:** `src/shared-services/state-machine.manager.js` - Global state with session-based backend sync
- **Core Services:** Located in `src/services/`
  - `normalizer.functions.js` - Pure functions for term normalization (exact cache, fuzzy matching)
  - `normalizer.fuzzy.js` - String similarity algorithms (Levenshtein, Jaro-Winkler)
  - `live.tracker.js` - Real-time cell change detection and processing
  - `entity-cache.js` - Client-side caching of processed entities
  - `result-lookup.js` - Historical match lookups

### Backend (Python FastAPI)
- **Entry Point:** `backend-api/main.py` - FastAPI application with middleware setup
- **API Structure:**
  - `api/system.py` - Health checks, connection tests, activity logging
  - `api/research_pipeline.py` - Main `/research-and-match` endpoint (stateless LLM matching)
- **Core Modules:**
  - `core/llm_providers.py` - LLM abstraction layer (Groq/OpenAI)
  - `core/user_manager.py` - IP-based authentication with hot-reload
  - `research_and_rank/web_generate_entity_profile.py` - Web research + entity profiling
  - `research_and_rank/call_llm_for_ranking.py` - LLM-based candidate ranking
  - `research_and_rank/display_profile.py` - Entity profile formatting

### Data Flow: Three-Tier Matching Pipeline

```
User Input (Excel Cell)
    ↓
1. Exact Cache Lookup (Frontend)
   - Forward mappings: source → target
   - Reverse mappings: target → target
   - Instant response if found
    ↓
2. Fuzzy String Matching (Frontend)
   - Levenshtein distance, Jaro-Winkler similarity
   - FUZZY_FORWARD_THRESHOLD: 0.7 (strict)
   - FUZZY_REVERSE_THRESHOLD: 0.5 (lenient)
   - Fast local processing
    ↓
3. LLM Research Pipeline (Backend)
   POST /research-and-match
   - Web search via Brave API (or fallbacks: SearXNG → DuckDuckGo → Bing)
   - Entity profile generation (structured JSON schema)
   - LLM-based candidate ranking with confidence scores
   - Response includes: top candidate + ranked alternatives + web sources
    ↓
Result Application
   - Auto-apply high-confidence matches (>0.9)
   - Show ranked candidates for manual selection
   - Color-coded cells (green: high confidence, yellow: uncertain)
   - Log to activity feed + persistent storage
```

### Session-Based Architecture

The system uses a **session-less stateful frontend** with **stateless backend**:

**Frontend State (`state-machine.manager.js`):**
- Caches all mappings in memory (`appState.mappings.combined`)
- Tracks server status, config, settings, history cache
- Handles session recovery and state synchronization

**Backend State:**
- Stateless API endpoints (no user sessions)
- `match_database.json` - Persistent identifier index (rebuilt from activity logs on startup)
- `logs/activity_log_*.json` - Single source of truth for all matches

**Configuration Flow:**
1. User drags `app.config.json` into UI (`file-handling.js`)
2. Config specifies Excel workbook → column mappings → reference files
3. Frontend loads reference Excel files via Office.js API
4. Creates forward/reverse mapping dictionaries
5. Backend receives only the query terms (no bulk upload)

## Key Commands

### Development

**Frontend Development:**
```bash
npm install                    # Install dependencies (~900MB node_modules)
npm run dev-server            # Start webpack dev server (https://localhost:3000)
npm run validate              # Validate manifest.xml
```

**Backend Development:**
```bash
cd backend-api
python -m venv .venv
.venv\Scripts\activate        # Windows
source .venv/bin/activate     # Mac/Linux
pip install -r requirements.txt
python -m uvicorn main:app --reload                              # Local
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload  # Network
```

**Debugging:**
- Press `F5` in VS Code with Office Add-ins Developer Kit extension
- Auto-sideloads add-in in Excel for testing

### Building for Production

**Choose build command based on deployment scenario:**

```bash
# Standard build (GitHub Pages / development)
npm run build

# IIS Server deployment (shows filesystem paths to admins)
set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm
npm run build:iis

# Microsoft 365 deployment (hides all filesystem paths)
npm run build:m365

# Custom deployment with full control
set DEPLOYMENT_URL=http://your-server:8080/
set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm
set DEPLOYMENT_TYPE=iis
npm run build
```

**Output:** `dist/` folder contains all frontend files ready for deployment.

### Testing

```bash
# Backend health check
curl http://127.0.0.1:8000/health

# Test research pipeline (requires API key)
curl -X POST http://127.0.0.1:8000/research-and-match \
  -H "Content-Type: application/json" \
  -d '{"query":"stainless steel","candidates":["SS 304","SS 316","Carbon Steel"]}'
```

## Important Technical Details

### Office.js API Usage

**Cell Operations:**
- Reading: `context.workbook.worksheets.getActiveWorksheet().getUsedRange()`
- Writing: Use `worksheet.getRange(address).values = [[value]]`
- Events: `worksheet.onChanged.add()` for real-time tracking

**Best Practices:**
- Always batch operations inside `Excel.run(async (context) => { ... })`
- Use `context.sync()` to commit changes to Excel
- Handle errors with `context.sync().catch()`

### Configuration Schema (`app.config.json`)

Critical structure developers must understand:

```json
{
  "my_excel_files": {
    "Workbook.xlsx": {
      "columns": {
        "InputColumn": "OutputColumn"
      },
      "confidence_column_map": {
        "OutputColumn": "ConfidenceColumn"
      },
      "reference_lists": [
        {
          "reference_file_location": "C:\\path\\to\\reference.xlsx",
          "tab_name": "Sheet1",
          "lookup_column": "StandardTerms",
          "alias_column": "Aliases"  // Optional
        }
      ]
    }
  }
}
```

### State Machine Behavior

**State Transitions:**
```
Idle → Config Loaded → Mappings Loading → Mappings Loaded → Tracking Active
                                      ↓
                                  Session Initialized (backend ready for queries)
```

**Critical State Properties:**
- `state.mappings.loaded` - Must be `true` before tracking can start
- `state.server.online` - Backend availability status
- `state.session.initialized` - Backend has received reference terms
- `state.settings.requireServerOnline` - If `true`, disable tracking when offline

### LLM Provider Configuration

Backend supports multiple LLM providers via environment variables:

```bash
# Groq (default, recommended)
setx GROQ_API_KEY "your_key"

# OpenAI (alternative)
setx OPENAI_API_KEY "your_key"
```

**Provider Selection:** Auto-detected in `core/llm_providers.py` based on available API keys.

### Logging and Debugging

**Frontend Logs:**
- Browser DevTools Console (F12 in Excel desktop via Edge DevTools)
- Messages appear in task pane UI via `error-display.js`

**Backend Logs:**
- Console output (development)
- `backend-api/logs/app.log` (production)
- Activity logs: `backend-api/logs/activity_log_YYYYMMDD.json`

**Match Database:**
- Location: `backend-api/logs/match_database.json`
- Rebuilt from activity logs on server startup
- In-memory index for fast lookups

## Deployment Scenarios

### 1. Local Development
- Frontend: `npm run dev-server` (https://localhost:3000)
- Backend: `python -m uvicorn main:app --reload`
- Manifest: `manifest.xml` (points to localhost)

### 2. Network Deployment (IIS)
- Frontend: Build with `npm run build:iis`, deploy to IIS
- Backend: Run as Windows service or Docker container
- Manifest: `manifest-iis.xml` (update URLs to match server)
- Distribution: Network share catalog for Desktop Excel

### 3. Microsoft 365 (Cloud)
- Frontend: Build with `npm run build:m365`, host anywhere (GitHub Pages, Azure, etc.)
- Backend: Deploy to cloud VM or container
- Manifest: `manifest-cloud.xml` (upload via Excel Online → Add-ins → Upload)

## Common Patterns

### Adding a New Matching Algorithm

1. Add function to `src/services/normalizer.functions.js`
2. Update matching pipeline in `normalizer.functions.js:findMatch()`
3. Test with various input patterns
4. Update confidence thresholds if needed

### Adding a New Backend Endpoint

1. Create router in `backend-api/api/`
2. Import and include in `main.py`: `app.include_router(your_router)`
3. Add corresponding frontend API call in `src/utils/api-fetch.js`
4. Update state machine if endpoint affects app state

### Modifying UI Components

- UI components in `src/ui-components/` are modular
- Each component has its own init function
- Use `view-manager.js` to handle view switching
- Update `taskpane.html` for layout changes

### Updating LLM Prompts

- Prompts located in `backend-api/research_and_rank/`
- `call_llm_for_ranking.py` - Ranking logic
- `web_generate_entity_profile.py` - Entity profiling
- Test changes with various query types

## Security Considerations

**IP-Based Authentication:**
- Configured in `backend-api/config/users.json`
- Hot-reloads without server restart
- Middleware validates IP against allowed list

**CORS Configuration:**
- `backend-api/config/middleware.py` sets allowed origins
- Update for production deployments

**API Key Management:**
- Never commit `.env` files
- Use environment variables for production
- Backend logs warning if API keys missing

## File Structure Reference

```
TermNorm-excel/
├── src/                           # Frontend source
│   ├── taskpane/                  # Main UI entry point
│   ├── services/                  # Core business logic
│   ├── shared-services/           # Cross-cutting concerns (state, session)
│   ├── ui-components/             # UI building blocks
│   └── utils/                     # Helper functions
├── backend-api/                   # Python backend
│   ├── main.py                    # FastAPI app entry
│   ├── api/                       # API endpoints
│   ├── core/                      # Core functionality (LLM, auth, logging)
│   ├── research_and_rank/         # Matching algorithms
│   ├── config/                    # Settings and middleware
│   └── logs/                      # Activity logs + match database
├── config/                        # Config templates
│   └── app.config.json           # Workbook configuration schema
├── docs/                          # User documentation
├── dist/                          # Build output (generated)
├── manifest.xml                   # Excel add-in manifest (dev)
├── manifest-iis.xml              # IIS deployment manifest
├── manifest-cloud.xml            # M365 deployment manifest
├── webpack.config.js             # Build configuration
└── package.json                  # Node.js dependencies
```

## Testing Strategy

**Frontend:**
- Manual testing via Excel add-in sideloading
- Test all three matching tiers (cache, fuzzy, LLM)
- Verify cell coloring and confidence scores

**Backend:**
- Health endpoint: `/health`
- Connection test: `/test-connection`
- Main pipeline: `/research-and-match` with sample queries
- Check `match_database.json` updates after queries

**Integration:**
- Full workflow test: Config load → Mapping load → Cell tracking → Match application
- Test offline mode (fuzzy matching only)
- Test server reconnection scenarios

## Known Limitations

- **Browser Dependency:** Desktop Excel uses Edge WebView2 (check compatibility)
- **Office.js API Rate Limits:** Avoid excessive `context.sync()` calls in loops
- **Session Recovery:** Frontend handles reconnection, but long disconnects may require reload
- **Match Database Size:** Large databases (>10k identifiers) may impact startup time
- **LLM Rate Limits:** Respect provider rate limits (queue requests if needed)

## Additional Resources

- [Office Add-ins Documentation](https://learn.microsoft.com/en-us/office/dev/add-ins/)
- [Excel JavaScript API Reference](https://learn.microsoft.com/en-us/javascript/api/excel)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Webpack Configuration Guide](https://webpack.js.org/configuration/)
