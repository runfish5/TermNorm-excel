# Implement Comprehensive Testing Infrastructure

## Overview

TermNorm currently has **zero automated tests** despite being a production Excel add-in distributed to clients. This creates significant risks for code reliability, regression prevention, and maintenance. We need to implement a comprehensive testing strategy covering both frontend and backend components.

## Current State

**Missing:**
- No test files (`test*.js`, `test*.py`, `*.spec.js`)
- No testing frameworks in dependencies
- No test scripts in `package.json`
- No CI/CD test pipeline

**Impact:**
- Changes risk introducing regressions
- Refactoring is risky without test coverage
- No automated validation of critical paths
- Client trust issues with untested software

## Proposed Solution

### Phase 1: Backend Testing (Python/FastAPI)

**Framework:** pytest + pytest-asyncio + httpx

**Coverage Areas:**
1. **API Endpoints** (`api/system.py`, `api/research_pipeline.py`)
   - Health check responses
   - Authentication middleware (IP-based)
   - Request/response validation
   - Error handling (403, 503, custom exceptions)

2. **Core Services** (`core/user_manager.py`, `core/llm_providers.py`)
   - IP authentication logic
   - LLM provider configuration
   - Hot-reload user config

3. **Research Pipeline** (`research_and_rank/`)
   - Web search fallback chain (Brave → SearXNG → DDG → Bing)
   - Token matcher creation/disposal
   - LLM ranking logic
   - Candidate string correction

**Test Types:**
- Unit tests for utility functions
- Integration tests for API endpoints
- Mock external services (LLM APIs, web search)

**Dependencies to Add:**
```txt
pytest>=8.0.0
pytest-asyncio>=0.23.0
pytest-cov>=4.1.0
httpx>=0.26.0
pytest-mock>=3.12.0
```

### Phase 2: Frontend Testing (JavaScript/Office.js)

**Framework:** Jest + @testing-library/dom

**Coverage Areas:**
1. **Service Layer** (`services/`)
   - `live.tracker.js` - cell monitoring logic
   - `normalizer.functions.js` - normalization pipeline
   - `normalizer.fuzzy.js` - fuzzy matching algorithms

2. **Utility Layer** (`utils/`)
   - `api-fetch.js` - API communication wrapper
   - `server-utilities.js` - server connection checks
   - `column-utilities.js` - column mapping validation
   - `cell-utilities.js` - cell value processing

3. **State Management** (`shared-services/state-machine.manager.js`)
   - State transitions (idle → loading → synced | error)
   - Mapping cache management
   - Configuration validation

4. **Data Processing** (`data-processing/mapping.processor.js`)
   - Excel data loading
   - Mapping validation

**Test Types:**
- Unit tests for pure functions
- Integration tests for service interactions
- Mock Office.js APIs
- Snapshot tests for UI components

**Dependencies to Add:**
```json
{
  "devDependencies": {
    "jest": "^29.7.0",
    "@testing-library/dom": "^9.3.4",
    "@testing-library/jest-dom": "^6.1.5",
    "jest-environment-jsdom": "^29.7.0"
  }
}
```

### Phase 3: End-to-End Testing

**Framework:** Playwright (optional, for critical paths)

**Coverage:**
- Full normalization workflow
- Configuration loading
- Multi-workbook scenarios
- Error recovery paths

## Implementation Plan

1. **Backend Setup** (Est: 2-3 days)
   - Install pytest and dependencies
   - Create `backend-api/tests/` structure
   - Write tests for critical endpoints
   - Add coverage reporting

2. **Frontend Setup** (Est: 3-4 days)
   - Install Jest and dependencies
   - Configure Jest for Office.js environment
   - Mock Excel API interactions
   - Write tests for core services

3. **CI/CD Integration** (Est: 1 day)
   - Add GitHub Actions workflow
   - Run tests on PR and push
   - Enforce minimum coverage thresholds

4. **Documentation** (Est: 1 day)
   - Update README with test commands
   - Document testing patterns
   - Add contribution guidelines

## Success Metrics

- ✅ All critical API endpoints tested
- ✅ Core normalization logic covered
- ✅ Minimum 70% code coverage (target: 80%+)
- ✅ Tests run automatically in CI/CD
- ✅ Zero failures on main branch
- ✅ Test suite runs in <60 seconds

## Priority

**HIGH** - This is essential infrastructure for a production application distributed to clients. Testing should be implemented before the next major release.

## Related Files

**Backend:**
- `backend-api/main.py` - FastAPI app
- `backend-api/api/` - Endpoints
- `backend-api/core/` - Core services
- `backend-api/research_and_rank/` - Research pipeline

**Frontend:**
- `src/services/` - Business logic
- `src/utils/` - Helper functions
- `src/shared-services/` - State management
- `src/data-processing/` - Data loading

## Additional Notes

- Tests should run quickly (mock external services)
- Focus on testing behavior, not implementation details
- Prioritize critical paths (normalization pipeline, API endpoints)
- Consider adding pre-commit hooks to run tests locally
- Document mocking strategies for Office.js and LLM APIs

## Acceptance Criteria

- [ ] pytest installed and configured for backend
- [ ] Jest installed and configured for frontend
- [ ] Test scripts added to `package.json`
- [ ] Minimum 70% code coverage achieved
- [ ] CI/CD pipeline running tests automatically
- [ ] README updated with testing instructions
- [ ] At least 20 meaningful tests written
- [ ] All tests passing on main branch
