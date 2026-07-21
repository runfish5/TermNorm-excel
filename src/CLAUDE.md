# src/ — Excel add-in frontend (child layer)

This is the **Office.js Excel add-in** that consumes the TermNorm Python server. It is a
*consumer* of the backend, not the core of the project — the server (see the root `CLAUDE.md`)
is the half that PromptPotter optimizes. Guidance here loads on top of the root file whenever you
work under `src/`.

**Stack**: Vanilla JavaScript + Office.js. No framework. Event-driven, unidirectional state.

## Frontend Commands

```bash
npm run dev-server          # webpack dev server (port 3000)
npm run build               # production build
npm run build:iis           # build for IIS deployment
npm run build:m365          # build for Microsoft 365
npm test                    # Jest
npm run test:watch          # watch mode
npm run test:coverage       # coverage report
npm run lint                # ESLint
npm run lint:fix            # auto-fix
npm run start               # debug in Excel desktop (F5 in VS Code)
npm run validate            # validate manifest.xml
```

## Architecture (src/)

- **core/**: Event-driven state management
  - `state-store.js` - Immutable state container with subscriber pattern
  - `event-bus.js` - Pub/sub event system for loose coupling
  - `events.js` - Event type definitions (MAPPINGS_LOADED, MATCH_LOGGED, TRACKING_CHANGED, SESSION_HISTORY_CHANGED, etc.)
  - `state-actions.js` - Centralized state mutations (JSDoc typed)
- **services/**: Business logic and data processing
  - `live-tracker.js` - Excel cell change tracking, emits MATCH_LOGGED events
  - `normalizer.js` - Three-tier matching pipeline (JSDoc typed)
  - `workflows.js` - Async business logic: mappings, sessions, settings, tracking lifecycle (JSDoc typed)
  - `mapping-processor.js` - Excel mapping file processor
- **matchers/**: Matching algorithms
  - `matchers.js` - Cache + fuzzy matching (single threshold, default 0.7) (JSDoc typed)
- **taskpane/**: Main entry point (`taskpane.js` - Office.onReady, wizard state machine)
- **ui-components/**: Reusable UI modules
  - `thermometer.js` - Progress/status indicator with two modes
  - `candidate-ranking.js` - Drag-to-rank candidate selection
  - `processing-history.js` - Matching Journal view, listens for MATCH_LOGGED events
  - `direct-prompt.js` - Custom LLM inference UI with fuzzy validation and candidate picker
  - `file-handling.js` - Config file drag-and-drop
  - `mapping-config.js` - Mapping configuration panel
  - `settings-panel.js` - Settings UI
- **utils/**: DOM and API helpers
  - `api-fetch.js` - Backend API client + server utilities (JSDoc typed)
  - `dom-helpers.js` - `$()`, `showView()`, modal helpers
  - `column-utilities.js` - Column mapping builders (JSDoc typed)
  - `error-display.js` - User-facing status messages
  - `settings-manager.js` - Persistent settings storage
  - `status-indicators.js` - LED indicators and status updates
  - `app-utilities.js` - Version display, relevance colors
  - `history-cache.js` - Processing history cache
- **config/**: Configuration constants
  - `config.js` - All constants, thresholds, JSDoc typedefs (MatchResult, CellState, MappingData)
  - `pipeline.json` - Frontend pipeline config; owns local tiers and declares `backend_pipeline: "default"`
- **design-system/**: CSS architecture
  - `tokens.css` - Color, spacing, typography variables
  - `utilities.css` - Utility classes (hidden, flex, etc.)
  - `components.css` - Badges, cards, buttons, forms

## Key Patterns (frontend)

1. **Event-Driven UI**: Components react to events from event-bus (MAPPINGS_LOADED, CANDIDATES_AVAILABLE, MATCH_LOGGED).
2. **Service/UI Boundary**: Services emit events, UI listens. No direct imports from services → UI.
3. **Unified State Store**: All state lives in `state-store.js`.
   - Cell state: `session.workbooks[workbookId].cells[cellKey]`
   - Mutations via `state-actions.js` functions
4. **Centralized Config**: All constants in `config/config.js` with JSDoc typedefs.
5. **Workbook-Scoped Tracking**: Multiple workbooks track cells independently.
6. **Office.js Operations**: Batch inside `Excel.run(async (ctx) => {...})`, commit with `ctx.sync()`.
7. **$ Helper Pattern**: DOM queries via `const $ = id => document.getElementById(id)`.
8. **Thermometer Component**: Progress indicator in persistent dashboard with two modes:
   - `progress`: Sequential steps, collapsible, fill bar (setup wizard: server→config→mappings→activate)
   - `status`: Independent toggleable states (research pipeline: web→LLM→score→rank)
9. **Centralized Tracking Workflows**: Tracking state managed via `workflows.js` with `TRACKING_CHANGED` events for reactive UI updates.

## Code Quality Standards (frontend)

**Maintainability**: Focused modules with clear responsibilities. Complexity added only when needed.

**Direct State Access**: State accessed via `state.server.online` for simplicity. No getters/setters unless needed.

**Central Coordination**: `taskpane.js` orchestrates services while delegating specialized work to dedicated modules.

**Type Definitions**: Key functions have JSDoc types for IDE autocomplete. Shared types defined in `config/config.js`:
- `MatchResult` - Normalization result (target, method, confidence, candidates, etc.)
- `CellState` - Cell processing state (value, status, row, col, result)
- `MappingData` - Forward/reverse mappings with metadata

## Frontend Configuration

- `manifest.xml` - Development manifest (localhost:3000)
- `manifest-iis.xml` - IIS/network deployment
- `manifest-cloud.xml` - Microsoft 365 deployment
- `config/app.config.json` - Frontend runtime config (backend URL, column mappings)
- `src/config/pipeline.json` - Frontend pipeline config with `backend_pipeline` reference

### app.config.json Structure
```json
{
  "backend_url": "http://127.0.0.1:8000",
  "excel-projects": {
    "Workbook.xlsx": {
      "column_map": {
        "InputColumn": { "output": "OutputColumn", "confidence": "ConfidenceColumn" }
      },
      "standard_mappings": [{
        "mapping_reference": "C:\\path\\to\\reference.xlsx",
        "worksheet": "Sheet1",
        "source_column": "SourceCol",
        "target_column": "TargetCol"
      }]
    }
  }
}
```

Column mapping structure: `{ "InputColumn": { "output": "OutputColumn", "confidence": "ConfidenceColumn" } }`. The `confidence` field is optional.

## Testing

Frontend tests are in `__tests__/` directories adjacent to source files:
- `src/core/__tests__/` - State store and event bus tests

Run a single test file:
```bash
npm test -- src/core/__tests__/state-store.test.js
```

## Data Flow

The add-in follows a structured event-driven workflow:

```
App Initialization
    ↓
Configuration Loading (Drag & Drop or filesystem)
    ↓
Server Setup (backend-api FastAPI on localhost:8000)
    ↓
Mapping Processing (Auto-load reference files + validate column mappings)
    ↓
Auto-Activate Live Tracking (ON/OFF toggle in dashboard)
    ↓
[User Input: Cell Entry + Enter]
    ↓
Normalization Pipeline  →  POST /matches on the server
    ├─ 1. Quick lookup (cached)
    ├─ 2. Fuzzy matching
    └─ 3. LLM research
    ↓
Results Display (Ranked candidates + status indicators)
    ↓
Optional: User Selection (Apply term → update target column)
    ↓
Logging (MATCH_LOGGED event → history + backend)
```

## Known Limitations

1. **Single Excel Instance Per Project**: Each Excel file runs its own add-in instance with isolated
   state. Opening the same file twice creates two independent instances.
