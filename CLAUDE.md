# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Excel Add-in Development**:
- `npm run start` - Launch add-in in Excel desktop (primary development method)
- `npm run start:web` - Launch add-in in Excel on the web
- `npm run stop` - Stop debugging add-in
- `npm run dev-server` - Start development server only (port 3000)
- `npm run build` - Build for production
- `npm run build:dev` - Build for development  
- `npm run lint` - Run ESLint checks
- `npm run lint:fix` - Fix ESLint issues
- `npm run validate` - Validate manifest.xml
- `npm run watch` - Watch mode for development

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
- `AppOrchestrator` - Main application controller and event coordination
- `LiveTracker` - Real-time Excel cell monitoring and processing engine  
- `NormalizerRouter` - Routes normalization requests to appropriate processors
- `ConfigManager` - Handles configuration loading from `config/app.config.json`
- `UIManager` - Manages task pane UI state and components
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
2. Add-in monitors configured source columns for cell edits
3. `LiveTracker` detects changes via Office.js event handlers
4. Cell values are sent to backend API for normalization
5. AI/LLM processes terms and returns standardized candidates
6. Results populate target columns with confidence-based color coding
7. User can review and select from candidate suggestions via UI

## Configuration

- **App Config**: `config/app.config.json` defines column mappings and standard mappings
- **Project Mappings**: `config/app.config.json` contains Excel-specific configurations
- **Manifest**: `manifest.xml` defines Office Add-in metadata and permissions

## Key Architecture Patterns

- **Orchestrator Pattern**: `AppOrchestrator` coordinates all services
- **Observer Pattern**: Excel change events trigger normalization pipeline
- **Strategy Pattern**: `NormalizerRouter` selects appropriate normalization approach
- **State Management**: Centralized state via `state.manager.js` for UI consistency
- **Modular Services**: Clean separation between Excel integration, AI processing, and UI management

## Development Notes

- Add-in runs in Excel's web runtime environment with security restrictions
- Development requires Excel with Office Add-ins Development Kit extension in VS Code
- Uses HTTPS development server (port 3000) with Office dev certificates
- Backend API needs CORS configuration for localhost:3000
- Configuration files use absolute Windows paths for Excel file references
- Activity logging captures all normalization operations to `backend-api/logs/activity.jsonl`