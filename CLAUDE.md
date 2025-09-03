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

### Core Components (Flattened Architecture)
- `AppOrchestrator` - Central coordinator, owns LiveTracker, handles config/mapping modules
- `LiveTracker` - Real-time Excel cell monitoring with defensive programming
- `NormalizerRouter` - Processing strategy (cached/API/fuzzy matching)
- `StateManager` - Centralized state management and configuration storage
- `taskpane.js` - Entry point with direct event binding, server status, drag/drop config
- `ActivityFeedUI` & `CandidateRankingUI` - Self-contained UI components with lazy initialization

### Backend (FastAPI)
- `python main.py` - Aggregates API endpoints
- LLM integration for term matching and generation

### Data Flow (Simplified)
1. Config drag/drop → StateManager → AppOrchestrator → MappingConfigModules
2. Cell edit → `LiveTracker` → `NormalizerRouter` → Backend API
3. Results → Excel cells + ActivityFeed + CandidateRankingUI → Activity logging

## Configuration

- `config/app.config.json` - Column mappings and standard mappings
- `manifest.xml` - Office Add-in metadata

## Architecture Evolution

**Phase 1**: Fixed duplicate LiveTracker - only `AppOrchestrator` owns it  
**Phase 2**: Removed unused template files, renamed `normalizer.main.js` → `live.tracker.js`  
**Phase 3**: Made `loadAndProcessMappings()` pure function  
**Phase 4**: Made ConfigManager stateless - removed static import, uses StateManager for all config storage  
**Phase 5**: Eliminated UIManager (277 lines) - moved functionality to taskpane.js and orchestrator  
**Phase 6**: Eliminated NavigationManager (74 lines) - inlined view switching to taskpane.js  
**Phase 7**: Eliminated ServerStatusManager (192 lines) - inlined server functionality to taskpane.js  

**Total Eliminated**: ~666 lines across manager pattern files, simplified to direct event binding

## Simple Theme System

**CSS-based themes** with single HTML file approach:

**Available Themes**:
- `default` - Standard professional UI (use for development)
- `ocean` - Ocean depths theme with blue/cyan colors
- `artdeco` - Art deco theme with gold/burgundy colors

**Implementation**: 
- Single `taskpane.html` with embedded CSS theme classes
- Simple JavaScript: `document.body.className = 'theme-${theme}'`
- Dropdown selector stores selection in localStorage

**Usage**: Select theme from dropdown in nav-bar, page reloads with new theme

## Project-Specific Patterns

**Flattened Architecture**: Eliminated manager pattern in favor of direct event binding and component self-management  
**Defensive Programming**: All querySelector calls use optional chaining (`?.querySelector`) with null safety  
**Lazy Initialization**: UI components reinitialize containers if null, handles init order issues  
**Global Debug Objects**: `window.app` and `window.state` exposed in taskpane.js and app.orchestrator.js  
**Office.js Integration**: Uses `Office.onReady()` and `Excel.run()` patterns throughout  
**Drag-Drop Config**: taskpane.js handles JSON config file drops with StateManager integration  
**Details Element UI**: Uses HTML `<details>` with `.open` property manipulation for collapsible sections  
**Dynamic Import**: Uses `import()` to load `app.config.json` at runtime via AppOrchestrator  
**Centralized State**: StateManager handles all configuration and server state, components subscribe to changes

## File Structure (20 files, ~2,554 lines)

**Entry Point**: `taskpane/taskpane.js` (403 lines) - Office.js initialization, direct event binding  
**Core Services**: `shared-services/` - AppOrchestrator (210 lines), StateManager (137 lines)  
**Cell Processing**: `services/` - LiveTracker (165 lines), NormalizerRouter (123 lines)  
**UI Components**: `ui-components/` - CandidateRankingUI (226 lines), ActivityFeedUI (100 lines)  
**Utilities**: `utils/` - Pure functions for cell processing, Excel operations, server config