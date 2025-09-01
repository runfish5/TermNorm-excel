# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Excel Add-in Development**:
- `npm run start` - Launch add-in in Excel desktop (primary development method)
- `npm run start:desktop` - Launch add-in in Excel desktop (explicit)
- `npm run start:web` - Launch add-in in Excel on the web
- `npm run stop` - Stop debugging add-in
- `npm run dev-server` - Start development server only (port 3000)
- `npm run build` - Build for production
- `npm run build:dev` - Build for development
- `npm run lint` - Run ESLint checks
- `npm run lint:fix` - Fix ESLint issues
- `npm run prettier` - Format code with Prettier
- `npm run validate` - Validate manifest.xml
- `npm run watch` - Watch mode for development
- `npm run signin` - Sign in to M365 account for development
- `npm run signout` - Sign out of M365 account

**Backend API**:
- Navigate to `backend-api/` directory
- `python main.py` - Start FastAPI server (typically port 8000)
- Backend requires Python virtual environment with dependencies from `requirements.txt`
- Uses FastAPI with LLM providers for term normalization

## Architecture Overview

This is a **TermNorm Excel Add-in** - a data normalization tool that uses AI to standardize terminology in Excel worksheets. The add-in is triggered and controlled from within Excel itself. It consists of two main parts:

### Excel Add-in (JavaScript)
- **Technology**: Vanilla JavaScript with Office.js API, Webpack bundling
- **Deployment**: Runs as sideloaded add-in in Excel desktop/web via Office Add-ins Development Kit
- **Entry Point**: `src/taskpane/taskpane.js` initializes when Excel loads the add-in
- **Core Service**: `LiveTracker` (in `normalizer.main.js`) monitors Excel cell changes in real-time
- **Architecture Pattern**: Orchestrator pattern with separate managers for config, state, and UI

**Key Components**:
- `AppOrchestrator` - Main application controller, owns LiveTracker and coordinates business logic
- `LiveTracker` - Real-time Excel cell monitoring and processing engine (in `normalizer.main.js`)
- `NormalizerRouter` - Routes normalization requests to appropriate processors (fuzzy, API, cached)
- `ConfigManager` - Handles configuration loading from `config/app.config.json`
- `UIManager` - Manages task pane UI state, components, and delegates business actions to orchestrator
- `ActivityFeed` - Real-time activity logging and user feedback

### Backend (Python FastAPI)
- **Technology**: FastAPI with LLM integration (Groq/other providers)
- **Main Router**: `main.py` aggregates multiple API endpoint routers
- **Key Services**: 
  - Term matching and research (`research_and_rank/`)
  - Pattern analysis (`pattern_analyzer.py`)
  - LLM-powered term generation (`llm_term_generator_api.py`)

### Data Flow
1. User opens Excel and loads the TermNorm add-in via task pane
2. `taskpane.js` initializes `AppOrchestrator`, which initializes `UIManager`
3. User configures column mappings and starts tracking via UI button
4. `UIManager` delegates tracking start to `AppOrchestrator.startTracking()`
5. `AppOrchestrator` owns `LiveTracker` which monitors Excel cell changes via Office.js event handlers
6. Cell value changes trigger `NormalizerRouter` which tries: cached → API → fuzzy matching
7. AI/LLM processes terms and returns standardized candidates with confidence scores
8. Results populate target columns with confidence-based color coding
9. User can review and select from candidate suggestions via `CandidateRankingUI`

## Configuration

- **App Config**: `config/app.config.json` defines column mappings and standard mappings
- **Project Mappings**: `config/project_mappings/` contains Excel-specific configurations
- **Manifest**: `manifest.xml` defines Office Add-in metadata and permissions

## Key Architecture Patterns

- **Orchestrator Pattern**: `AppOrchestrator` coordinates business logic and owns core services like `LiveTracker`
- **Observer Pattern**: Excel change events trigger normalization pipeline via Office.js event handlers
- **Strategy Pattern**: `NormalizerRouter` selects appropriate normalization approach (cached/API/fuzzy)
- **Delegation Pattern**: `UIManager` handles UI events but delegates business logic to `AppOrchestrator`
- **State Management**: Centralized state via `state.manager.js` for UI consistency
- **Modular Services**: Clean separation between Excel integration, AI processing, and UI management

## Recent Architecture Improvements

**Eliminated Duplicate LiveTracker Issue**:
- Previously: Both `UIManager` and `AppOrchestrator` created separate `LiveTracker` instances
- Now: Only `AppOrchestrator` owns the `LiveTracker`, `UIManager` delegates tracking actions
- Result: Clearer responsibility chain and single source of truth for tracking lifecycle

## Development Notes

- Add-in runs in Excel's web runtime environment with security restrictions
- Development requires Excel with Office Add-ins Development Kit extension in VS Code
- Uses HTTPS development server (port 3000) with Office dev certificates
- Backend API needs CORS configuration for localhost:3000
- Configuration files use absolute Windows paths for Excel file references
- Activity logging captures all normalization operations to `backend-api/logs/activity.jsonl`