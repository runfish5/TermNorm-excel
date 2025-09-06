# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TermNorm is an Excel add-in that provides real-time terminology normalization using AI-powered matching. It consists of two main components:

1. **Frontend**: Office JavaScript add-in built with Webpack, deployed as a task pane in Excel
2. **Backend**: Python FastAPI server that handles LLM processing, fuzzy matching, and term standardization

The add-in monitors Excel cells in real-time, applies configurable mapping rules, and provides AI-powered term suggestions through integration with LLM providers (Groq/OpenAI).

## Development Commands

### Frontend (Office Add-in)
- `npm run build` - Production build with version update
- `npm run build:dev` - Development build with version update  
- `npm run dev-server` - Start webpack dev server (https://localhost:3000)
- `npm start` - Launch add-in in Excel desktop
- `npm run start:web` - Launch add-in in Excel web
- `npm run lint` - Run ESLint checks
- `npm run lint:fix` - Fix ESLint issues automatically
- `npm run validate` - Validate manifest.xml
- `npm run watch` - Development build with file watching

### Backend (Python API)
Navigate to `backend-api/` directory first:
- `.\venv\Scripts\activate` - Activate Python virtual environment
- `python -m uvicorn main:app --reload` - Start development server (localhost:8000)
- `python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload` - Start network server
- Set `TERMNORM_API_KEY` environment variable before starting production server

## Architecture

### Frontend Structure
```
src/
├── taskpane/           # Main Excel task pane UI and entry point
├── shared-services/    # Core business logic and state management
│   ├── app.orchestrator.js    # Main application coordinator
│   └── state.manager.js       # Centralized state management
├── services/           # Processing and API services
│   ├── live.tracker.js        # Real-time cell monitoring
│   ├── normalizer.router.js   # Term normalization routing
│   └── normalizer.fuzzy.js    # Fuzzy matching logic
├── ui-components/      # Reusable UI components
├── utils/              # Utility functions and helpers
└── data-processing/    # Data transformation and mapping
```

### Backend Structure
```
backend-api/
├── main.py                    # FastAPI application entry point
├── research_and_rank/         # LLM and ranking algorithms
├── llm_term_generator_api.py  # LLM API integration
└── pattern_analyzer.py       # Text pattern analysis
```

### Key Integration Points

**State Management**: The frontend uses a centralized state manager (`state.manager.js`) that coordinates between UI components and services. Subscribe to state changes using `state.subscribe()`.

**Configuration System**: Project configurations are stored in `config/app.config.json` with per-workbook mappings that define:
- Column mappings (input → output columns)
- Reference file paths and worksheet specifications
- Standard mapping sources

**Cell Monitoring**: `LiveTracker` service monitors Excel worksheet changes and triggers normalization through the routing system.

**API Communication**: Frontend communicates with Python backend via REST API calls to localhost:8000 for LLM processing and term analysis.

## Event Task Flowchart

The TermNorm add-in follows a structured event-driven workflow from initialization to term processing:

```
App Initialization
    ↓
Configuration Loading
    ├─ Drag & Drop config file (365 Cloud)
    └─ Load from filesystem (Local Excel)
    ↓
Python Server Setup & Startup
    ├─ Virtual environment activation
    ├─ API key configuration (TERMNORM_API_KEY)
    └─ FastAPI server launch (localhost:8000)
    ↓
Excel Files & Mapping Processing
    ├─ Load reference Excel files via Browse button
    ├─ Process standard mappings configuration
    └─ Validate column mappings from app.config.json
    ↓
Activate Real-time Tracking
    └─ LiveTracker service begins monitoring worksheet changes
    ↓
Cell Monitoring Active
    └─ System ready for user input
    ↓
User Input Event (Cell Entry + Enter)
    └─ Triggers normalization pipeline
    ↓
Term Normalization Pipeline
    ├─ 1. Quick lookup (cached mappings)
    ├─ 2. Fuzzy matching (similar terms via normalizer.fuzzy.js)
    └─ 3. Advanced search (API requests + LLM processing)
    ↓
Results Display
    ├─ Candidate ranking in "Tracking Results" panel
    ├─ Color-coded status indicators
    └─ Activity tracking panel update
    ↓
User Selection & Application
    ├─ Review candidates in "Candidate Ranked" view
    ├─ Apply selected term via "apply-first" button
    └─ Auto-update target column
    ↓
Logging & Persistence
    ├─ Activity log entry (backend-api/logs/activity.jsonl)
    ├─ State management update via state.manager.js
    └─ History view update for future reference
```

### Key Event Triggers

- **Configuration Events**: File drop, config reload, server status changes
- **User Input Events**: Cell selection, Enter key press, button clicks
- **Processing Events**: API calls, fuzzy matching, LLM requests
- **UI Update Events**: Result display, status indicators, activity feed updates
- **Persistence Events**: Logging actions, state changes, mapping updates

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

1. **API Keys**: Set `TERMNORM_API_KEY` environment variable for backend authentication
2. **LLM Provider**: Configure Groq or OpenAI API keys in backend environment
3. **Development Certificates**: Office add-in requires HTTPS certificates (handled by office-addin-dev-certs)
4. **Python Environment**: Backend requires Python virtual environment with FastAPI dependencies

## Testing and Validation

**IMPORTANT**: Do not automatically run tests or start testing procedures. The user will handle testing manually.

- Use `npm run validate` to check manifest.xml syntax only when explicitly requested
- Backend includes built-in API documentation at `/docs` endpoint for reference
- Monitor real-time processing through the Activity Feed UI component
- Check server status using the status indicator in the task pane
- Wait for user instruction before running any validation or testing commands

## Manifest Configuration

The add-in uses `manifest.xml` for Office integration. Key configuration:
- Development: Uses localhost:3000 (webpack dev server)
- Production: Update URLs in manifest for deployment
- Supports both desktop and web Excel versions