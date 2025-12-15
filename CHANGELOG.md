# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2025-12-15

### Highlights

**Matching Journal (formerly "Activity History")**
- Renamed view to "Matching Journal" for clarity
- Complete overhaul of history tracking and deduplication logic
- Fixed timestamp-sorted insertion: delayed API responses no longer appear as "newest" assignment
- Fixed trimming logic: now evicts oldest entries by timestamp (was incorrectly removing most recent)
- Added `web_search_status` to history entries: warning icon persists across page refreshes
- New history indicator (🕐N) with clickable popup showing all assignments for a source
- Popup highlights current assignment (★) and allows viewing details of any historical entry
- Consolidated score columns into single Scores column with relevance calculation

**Cell Selection Navigation**
- Fixed scrolling to outdated entries: now looks up by normalized source key
- Uses `sourceIndex` Map for O(1) case-insensitive lookup
- Correctly displays details for current target (from row's data-identifier)

**Thermometer Component**
- New progress/status indicator with two modes
- Setup wizard: Sequential steps (server→config→mappings→activate) with auto-progression
- Research pipeline: Toggleable steps (web search→LLM→scoring→LLM ranking)
- LLM ranking toggle allows skipping second LLM call for faster processing

**UI/UX Improvements**
- New Home tab with setup wizard and hero cover
- Professional navbar redesign with cleaner layout
- Settings groups with card-like appearance and subtle shadows
- Status bar made sticky, "Backend" renamed to "Py-Server"
- Bubble animation replacing hourglass loader
- Direct Prompt integrated into event pipeline with batch semantics

**DirectEdit Reliability**
- Fixed duplicate row bug: DirectEdit now uses stored source value from cell state
- Fallback to Excel read when cell state doesn't exist (previous sessions)
- USER_ACTION_CONFIDENCE constant ensures consistent 100% confidence for UserChoice/DirectEdit
- Guaranteed source key matching prevents spurious duplicates from whitespace/casing differences
- History entries stay synced with latest state values (confidence, method) when viewing older traces

**Performance**
- Removed Microsoft Fabric CSS dependency (100KB CDN eliminated)
- Migrated 24+ hardcoded colors to CSS token variables
- Consolidated 3 button systems to unified `btn-primary`/`btn-secondary`
- Frontend cache history limit increased from 50 to 999

### Bug Fixes
- Fixed double-nested details element causing duplicate collapse triangles
- Fixed status message alignment (now left-bound with badge styling)
- Fixed auto-progression jumping backward when events re-fire
- Fixed responsive navbar layout for narrow taskpanes
- Fixed relevance_score calculation from core_concept + spec scores

### Technical Details
- 48 commits since v1.0.3: 6 features, 15 refactors, 7 fixes, 4 docs
- Source normalization: trim + lowercase + collapse whitespace + Unicode NFC
- History entries now include: `{ timestamp, target, method, confidence, web_search_status }`
- `handleCellSelection` prioritizes source lookup over identifier lookup
- New experiments API endpoint for external eval/optimization servers
- Improved Python server setup UX for first-time users
- No breaking changes from v1.0.3

## [1.0.3] - 2025-12-08

### Highlights

**Direct-Prompt UI**
- New UI component for custom LLM inference and testing
- Send arbitrary prompts directly to backend LLM providers
- Batch logging support for prompt experimentation

**Langfuse-Compatible Logging System**
- Production logging with traces, observations, scores, and datasets
- Cache hits and fuzzy matches now logged for evaluation tracking
- DirectEdit corrections logged as ground truth for model improvement
- Datetime-prefixed IDs compatible with MLflow UI
- New `events.jsonl` format bridging MLflow, Langfuse, and future tooling (replaces deprecated `activity.jsonl`)

**Documentation Overhaul**
- First comprehensive cleanup pass (~90% refinement)
- Reorganized docs structure: INSTALLATION → SETUP-GUIDE → CONFIGURATION → TROUBLESHOOTING
- Simplified guides for non-technical users
- Langfuse data model specification (`LANGFUSE_DATA_MODEL.md`)

**Architecture Modernization**
- Event-driven architecture with pub/sub Event Bus
- Immutable State Store replacing scattered state mutations
- Domain layer extraction (Cache Matcher, Fuzzy Matcher)
- Comprehensive test coverage for core modules

**Code Quality**
- ~2,500 lines removed through DRY utilities and dead code cleanup
- Standardized file naming (kebab-case convention)
- Centralized hyperparameters in configuration files
- Simplified UI components (44-67% size reductions)

### Technical Details
- 94 commits since v1.0.2: 12 features, 45 refactors, 10 fixes, 15 docs
- No breaking changes from v1.0.2
- Configuration file format unchanged

## [1.0.2] - 2025-11-27

### Highlights

**User-Facing Improvements**
- Help icon with terminology legend explaining normalization concepts
- Confidence column output showing match quality (0-100 scale)
- Critical fix: Workbook-isolated cell state prevents data corruption across multiple workbooks
- Improved Python version auto-detection with clear error messaging

**Deployment & Infrastructure**
- Automated deployment package creation for GitHub releases
- Enhanced deployment documentation for IIS and M365 environments
- Improved UI path display for different deployment scenarios

**Code Quality**
- Unified design system implementation (reduced CSS by 218 lines)
- Refactored activity tracking services for better maintainability
- Multiple performance and stability improvements

### Technical Details
- 47 commits since v1.0.1: 9 features, 8 bug fixes, 24 refactoring improvements
- No breaking changes from v1.0.1
- Configuration file format unchanged

## [1.0.1] - 2025-11-16

### Key Improvements for Users

**Enterprise Deployment**
- Windows Server deployment with IIS (industry-standard approach for internal networks)
- Simplified deployment with automated scripts
- Comprehensive troubleshooting guides for IT administrators

**Performance & Reliability**
- Faster matching with per-user caching
- More reliable session-based architecture
- Better error handling and recovery

**User Experience**
- Professional loading animations (sandclock indicator)
- Smoother cell updates during normalization
- Better visual feedback throughout the application

**Enhanced Search Capabilities**
- Brave API integration for improved web research
- More reliable web scraping with fallback providers
- Better handling of search failures

**Improved Setup**
- Better virtual environment location (project directory instead of backend-api/)
- Auto-detect Python command (python or py)
- Automated server startup with diagnostics

**Documentation & Support**
- Inline troubleshooting in installation guide
- Step-by-step manual deployment instructions
- Clear Excel cache clearing procedures
- Architecture documentation for developers

### Technical Changes

**Architecture**
- Session-based architecture (replaced caching system)
- 8-phase maintainability refactor for session management
- Centralized warning badge system

**Development & Deployment**
- Script organization into subdirectories (build/, deployment/)
- Webpack config updates (config folder in build output)
- PowerShell quote escaping fixes in deployment scripts
- Ultra-optimized server startup script

**Code Quality**
- Replace template placeholders with TermNorm branding
- Remove obsolete development documentation
- Remove outdated API key authentication system

**Bug Fixes**
- Excel cache clearing for deployment updates
- Target cells immediate update during sequential normalization
- Documentation alignment with venv path changes
- Web scraping fallbacks and error handling

## [1.0.0] - 2025-11-12

Initial release with core functionality:
- Excel add-in for term normalization
- Backend API with LLM integration
- Fuzzy matching and caching
- Real-time cell tracking
- Configuration management
