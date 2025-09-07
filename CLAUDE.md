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

### Frontend Architecture: Function-First Design

**Core Application Layer**
- `taskpane/taskpane.js` - Application orchestrator with pure function delegation
- `shared-services/state.manager.js` - Centralized state with direct property access

**Service Layer: Specialized Processing**
- `services/live.tracker.js` - Real-time cell monitoring (utilities extracted to utils/)
- `services/normalizer.functions.js` - Pure functions for term normalization pipeline
- `services/normalizer.fuzzy.js` - Fuzzy matching algorithms

**UI Layer: Function-Based Components**
- `ui-components/` - Pure functions for UI operations (no classes)
- `ui-components/view-manager.js` - Direct DOM manipulation functions
- `ui-components/file-handling.js` - Drag & drop with extracted configuration logic
- `ui-components/mapping-config-functions.js` - Pure functions for mapping UI

**Utility Layer: Single-Purpose Modules**
- `utils/column-utilities.js` - Column mapping and validation functions
- `utils/cell-utilities.js` - Cell value processing and change detection
- `utils/color-utilities.js` - UI color management and scoring visualization
- `utils/activity-logger.js` - Session logging and backend communication
- `utils/config-processor.js` - Pure functions for configuration validation
- `utils/server-utilities.js` - Consolidated server configuration and status management
- `utils/version.js` - Simple version display with pure function exports
- `utils/app-utilities.js` - General application utilities

**Data Processing Layer**
- `data-processing/mapping.processor.js` - Streamlined mapping with direct validation

### Backend Structure
```
backend-api/
├── main.py                    # FastAPI application entry point
├── research_and_rank/         # LLM and ranking algorithms
├── llm_term_generator_api.py  # LLM API integration
└── pattern_analyzer.py       # Text pattern analysis
```

### Key Integration Points

**Central Orchestration**: `taskpane.js` serves as the main application coordinator, with configuration loading now extracted to `config-processor.js` pure functions and file handling modularized in `file-handling.js`.

**State Management**: The frontend uses a centralized state manager (`state.manager.js`) that coordinates between UI components and services. Subscribe to state changes using `state.subscribe()`.

**Configuration System**: Project configurations are processed using pure functions in `config-processor.js` for validation and workbook selection, with drag & drop handling in `file-handling.js`. Configurations define:
- Column mappings (input → output columns)
- Reference file paths and worksheet specifications
- Standard mapping sources

**Cell Monitoring**: `LiveTracker` service monitors Excel worksheet changes and triggers normalization using pure functions from `normalizer.functions.js`. Utility functions extracted to dedicated modules for reusability and maintainability.

**API Communication**: Frontend communicates with Python backend via REST API calls to localhost:8000 using consolidated server utilities (`getHost()`, `getHeaders()`, `getApiKey()`, `checkServerStatus()`) for LLM processing and term analysis.

## Exemplary Architecture Principles

**IMPORTANT**: This codebase demonstrates industry best practices through systematic architectural decisions:

**Function-First Design**: All utilities implemented as pure functions with single responsibilities, eliminating class-based complexity and improving testability. Classes converted to lightweight function modules reduce bundle size and cognitive overhead.

**Extracted Concerns**: Previously inlined utilities (80+ lines in LiveTracker) extracted to dedicated modules following separation of concerns and DRY principles. Creates reusable components and improves code organization.

**Direct Property Access**: StateManager uses direct property manipulation instead of complex path resolution, reducing cognitive overhead and improving performance while maintaining backward compatibility.

**Minimal Abstraction Layers**: Prefer direct function calls over object wrappers (e.g., `getHost()` vs `ServerConfig.getHost()`), eliminating unnecessary indirection and improving code clarity.

**Pure Function Extraction**: Complex operations broken into testable, reusable pure functions for config validation, cell processing, and color management. Enhances maintainability and enables better testing strategies.

**Central Coordination**: `taskpane.js` focuses on orchestration while delegating to specialized modules, maintaining clear separation of concerns without over-engineering.

When making changes, preserve this streamlined approach and resist over-engineering patterns.

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

## Code Quality & Maintainability Standards

This codebase demonstrates industry best practices through systematic refactoring:

**Class-to-Function Migration**: Converted heavyweight classes (ActivityDisplay, aiPromptRenewer) to lightweight function modules, reducing bundle size and complexity while maintaining the same API.

**Utility Extraction Pattern**: Moved inline utilities to dedicated modules, creating reusable components and improving code organization. LiveTracker reduced from 260+ lines to focused core logic.

**Comment Minimization**: Removed redundant explanatory comments while preserving essential technical documentation, following clean code principles for improved readability.

**Simplified State Management**: Eliminated complex path-based APIs in favor of direct property access, improving performance and developer experience while maintaining backward compatibility.

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