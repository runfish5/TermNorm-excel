# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TermNorm is an Excel add-in that provides real-time terminology normalization using AI-powered matching. It consists of two main components:

1. **Frontend**: Office JavaScript add-in built with Webpack, deployed as a task pane in Excel
2. **Backend**: Python FastAPI server that handles LLM processing, fuzzy matching, and term standardization

The add-in monitors Excel cells in real-time, applies configurable mapping rules, and provides AI-powered term suggestions through integration with LLM providers (Groq/OpenAI).

## Development Commands

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
- `utils/activity-logger.js` - Session logging and backend communication
- `utils/config-processor.js` - Pure functions for configuration validation
- `utils/server-utilities.js` - Consolidated server configuration and status management
- `utils/app-utilities.js` - Consolidated application utilities (UI layout, Excel integration, color management, version display)

**Data Processing Layer**
- `data-processing/mapping.processor.js` - Streamlined mapping with direct validation

### Backend Structure - Ultra-lean Architecture
```
backend-api/
├── main.py                    # FastAPI application with 3 routers
├── config/                    # Centralized configuration and middleware
├── api/                       # API endpoints
│   ├── system.py             # Health checks and activity logging
│   ├── research_pipeline.py  # /research-and-match endpoint (core pipeline)
│   └── matcher_setup.py      # /update-matcher endpoint (TokenLookupMatcher)
├── core/                      # Core functionality
│   ├── llm_providers.py      # LLM provider configuration
│   └── logging.py            # Logging setup
├── research_and_rank/         # Research and ranking implementation
│   ├── web_generate_entity_profile.py
│   ├── display_profile.py
│   ├── call_llm_for_ranking.py
│   └── correct_candidate_strings.py
└── utils/                     # Utility functions
    └── utils.py              # Helper functions and color constants
```

### Key Integration Points

**Central Orchestration**: `taskpane.js` serves as the main application coordinator, with configuration loading now extracted to `config-processor.js` pure functions and file handling modularized in `file-handling.js`.

**State Management**: The frontend uses functional state management (`state.manager.js`) with direct property access and exported functions (`setStatus()`, `setConfig()`, `subscribe()`). State is accessed directly via `state.server.online` instead of complex path resolution.

**Configuration System**: Project configurations are processed using pure functions in `config-processor.js` for validation and workbook selection, with drag & drop handling in `file-handling.js`. Configurations define:
- Column mappings (input → output columns)
- Reference file paths and worksheet specifications
- Standard mapping sources

**Cell Monitoring**: Live tracking functions (`startTracking()`, `stopTracking()`) monitor Excel worksheet changes and trigger normalization using pure functions from `normalizer.functions.js`.

**API Communication**: Frontend communicates with Python backend via REST API calls to localhost:8000 using consolidated server utilities (`getHost()`, `getHeaders()`, `getApiKey()`, `checkServerStatus()`) for LLM processing and term analysis.

## Exemplary Architecture Principles

**IMPORTANT**: This codebase demonstrates industry best practices through systematic architectural decisions:

**Function-First Design**: Utilities are implemented as pure functions with single responsibilities.


**Direct Property Access**: Functional state management uses direct property manipulation (`state.server.online`) instead of complex path resolution, reducing cognitive overhead and improving performance while maintaining backward compatibility.

**Minimal Abstraction Layers**: Prefer direct function calls over object wrappers (e.g., `getHost()` vs `ServerConfig.getHost()`), eliminating unnecessary indirection and improving code clarity.


**Central Coordination**: `taskpane.js` focuses on orchestration while delegating to specialized modules, maintaining clear separation of concerns without over-engineering.

When making changes, preserve this streamlined approach and resist over-engineering patterns.

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

1. **API Keys**: Set `TERMNORM_API_KEY` environment variable for backend authentication
2. **LLM Provider**: Configure Groq or OpenAI API keys in backend environment
3. **Development Certificates**: Office add-in requires HTTPS certificates (handled by office-addin-dev-certs)
4. **Python Environment**: Backend requires Python virtual environment with FastAPI dependencies

## Code Quality & Maintainability Standards

This codebase demonstrates industry best practices through systematic refactoring:


**Comment Minimization**: Removed redundant explanatory comments while preserving essential technical documentation, following clean code principles for improved readability.

**Simplified State Management**: Eliminated complex path-based APIs in favor of direct property access, improving performance and developer experience while maintaining backward compatibility.