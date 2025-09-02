# CLAUDE.md

## Development Commands

**Excel Add-in**:
- `npm run start` - Launch add-in in Excel desktop
- `npm run start:web` - Launch add-in in Excel web
- `npm run build` - Build for production
- `npm run lint` - Run ESLint checks

**Backend API**:
- `python main.py` - Start FastAPI server (port 8000)

## Architecture

**TermNorm Excel Add-in** - AI-powered terminology standardization in Excel worksheets.

### Core Components
- `AppOrchestrator` - Business logic coordinator, owns LiveTracker
- `LiveTracker` - Real-time Excel cell monitoring (live.tracker.js)
- `NormalizerRouter` - Processing strategy (cached/API/fuzzy matching)
- `ConfigManager` - Loads config/app.config.json
- `UIManager` - UI events, delegates to AppOrchestrator
- `StateManager` - Centralized state management

### Backend (FastAPI)
- `python main.py` - Aggregates API endpoints
- LLM integration for term matching and generation

### Data Flow
1. Load config → Load mappings → Start tracking
2. Cell edit → `LiveTracker` → `NormalizerRouter` → Backend API
3. Results → Excel cells with color coding → Activity logging

## Configuration

- `config/app.config.json` - Column mappings and standard mappings
- `manifest.xml` - Office Add-in metadata

## Architecture Improvements

**Phase 1**: Fixed duplicate LiveTracker - only `AppOrchestrator` owns it
**Phase 2**: Removed unused template files, renamed `normalizer.main.js` → `live.tracker.js`  
**Phase 3**: Made `loadAndProcessMappings()` pure function
**Phase 4**: Made ConfigManager stateless - removed static import, uses StateManager for all config storage

## UI Theme Testing System

**WARNING**: Use `taskpane.html` (default theme) for all normal development work. Other themes are experimental testing variants only.

**Available Themes**:
- `taskpane.html` - Default professional UI (use for development)
- `taskpane2.html` - Art Deco theme (testing only)
- `taskpane3.html` - Ocean Depths + Cyberpunk theme (testing only)  
- `taskpane4.html` - Art Deco + Geometric theme (testing only)

**Testing Instructions**: Use dropdown in nav-bar to switch themes, or change `TEST_ITERATION` in taskpane.js

## Project-Specific Patterns

**Global Debug Objects**: `window.app` and `window.state` exposed in taskpane.js and app.orchestrator.js
**Office.js Integration**: Uses `Office.onReady()` and `Excel.run()` patterns throughout
**Drag-Drop Config**: UIManager handles JSON config file drops with custom validation
**Details Element UI**: Uses HTML `<details>` with `.open` property manipulation for collapsible sections  
**Dynamic Import**: Uses `import()` to load `app.config.json` at runtime in config.manager.js
**Mixed State Management**: Both centralized StateManager and local component state coexist