/**
 * State Manager - Frontend Cache + Backend Source of Truth
 *
 * Architecture:
 * 1. Frontend caches mappings for fast exact/fuzzy matching
 * 2. Backend stores TokenLookupMatcher for LLM research
 * 3. Health check on load verifies backend has data (no periodic reconciliation)
 * 4. Simple loading states: idle → loading → synced | error
 */

import { getHost, getHeaders } from "../utils/server-utilities.js";

// Global State - Simplified
const appState = {
  ui: {
    currentView: "config",
    statusMessage: "Ready",
    isError: false,
  },
  server: {
    online: false,
    host: null,
    apiKey: "",
    lastChecked: null,
  },
  backend: {
    sessionExists: false,
    sessionCheckedAt: null,
    sessionCreatedAt: null,
    termCount: 0,
  },
  config: {
    loaded: false,
    data: null,
    raw: null,  // Raw config data for reloading
  },
  mappings: {
    sources: {},     // index → {status, data, error}
    combined: null,  // Combined forward/reverse mappings cache
    loaded: false,
  },
};

let statusCallback = null;
let stateChangeCallbacks = [];

export function onStatusChange(callback) {
  statusCallback = callback;
}

export function onStateChange(callback) {
  stateChangeCallbacks.push(callback);
}

function notifyStatus() {
  statusCallback?.(appState.ui);
}

function notifyStateChange() {
  stateChangeCallbacks.forEach((cb) => cb(appState));
}

export function setStatus(message, isError = false) {
  appState.ui.statusMessage = message;
  appState.ui.isError = isError;
  notifyStatus();
}

export function setConfig(config) {
  appState.config.data = config;
  appState.config.loaded = true;
  notifyStateChange();
}

/**
 * Load Mapping Source - Simplified
 *
 * Steps:
 * 1. Set status to loading
 * 2. Load data (Excel + send to backend)
 * 3. Cache result in frontend state
 * 4. Combine all sources
 */
export async function loadMappingSource(index, loadFunction, params) {
  // Initialize source state if needed
  if (!appState.mappings.sources[index]) {
    appState.mappings.sources[index] = {
      status: "idle",
      data: null,
      error: null,
    };
  }

  const source = appState.mappings.sources[index];

  try {
    // Set loading state
    source.status = "loading";
    source.error = null;
    setStatus("Loading mapping table...");
    notifyStateChange();

    // Execute load operation (reads Excel, sends to backend)
    const result = await loadFunction(params);

    // Update frontend cache
    source.status = "synced";
    source.data = result;

    // Update backend session state (matcher was created/updated on backend)
    appState.backend.sessionExists = true;
    appState.backend.sessionCheckedAt = Date.now();
    if (index === 0) {
      appState.backend.sessionCreatedAt = Date.now();
    }
    const termCount = Object.keys(result.reverse || {}).length;
    appState.backend.termCount += termCount;

    // Combine all synced sources
    combineMappingSources();

    setStatus(`✅ Mapping ${index + 1} loaded (${termCount} terms)`);
    notifyStateChange();

    return result;
  } catch (error) {
    // Set error state
    source.status = "error";
    source.error = error.message;
    source.data = null;

    setStatus(`❌ Failed to load mapping ${index + 1}: ${error.message}`, true);
    notifyStateChange();

    throw error;
  }
}

/**
 * Combine all synced mapping sources into frontend cache
 */
function combineMappingSources() {
  const syncedSources = Object.values(appState.mappings.sources).filter(
    (s) => s.status === "synced" && s.data
  );

  if (syncedSources.length === 0) {
    appState.mappings.combined = null;
    appState.mappings.loaded = false;
    return;
  }

  const combined = { forward: {}, reverse: {}, metadata: { sources: [] } };

  syncedSources.forEach((source, idx) => {
    const data = source.data;
    if (data.forward) Object.assign(combined.forward, data.forward);
    if (data.reverse) Object.assign(combined.reverse, data.reverse);

    combined.metadata.sources.push({
      index: idx + 1,
      termCount: Object.keys(data.reverse || {}).length,
    });
  });

  appState.mappings.combined = combined;
  appState.mappings.loaded = true;
}

/**
 * Check if backend session exists
 * Called before major actions (tracking activation, LLM calls)
 * Updates state and returns result
 */
export async function checkBackendSession() {
  try {
    const projectId = appState.config.data?.workbook || "default";
    const params = new URLSearchParams({ project_id: projectId });
    const response = await fetch(`${getHost()}/session-health?${params}`, {
      method: "GET",
      headers: getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }

    const health = await response.json();

    // Update state
    appState.backend.sessionExists = health.exists;
    appState.backend.sessionCheckedAt = Date.now();
    if (health.exists) {
      appState.backend.termCount = health.term_count || 0;
    }
    notifyStateChange();

    return {
      exists: health.exists,
      needsReload: !health.exists && appState.mappings.loaded,
      message: health.exists
        ? `Backend session active (${health.term_count} terms)`
        : "Backend session expired - reload mappings to enable LLM research"
    };

  } catch (error) {
    console.error("Backend health check failed:", error);

    // Server might be down - mark session as unknown
    appState.backend.sessionExists = false;
    appState.backend.sessionCheckedAt = Date.now();
    notifyStateChange();

    return {
      exists: false,
      needsReload: false,
      message: `Cannot reach backend: ${error.message}`
    };
  }
}

/**
 * Clear all mapping sources
 */
export function clearMappings() {
  appState.mappings.sources = {};
  appState.mappings.combined = null;
  appState.mappings.loaded = false;
  notifyStateChange();
}

/**
 * Get current state (deep cloned read-only copy)
 * Uses JSON for simplicity - breaks functions/Dates but we don't store those
 */
export function getState() {
  return JSON.parse(JSON.stringify(appState));
}

// Direct state access for backward compatibility
export const state = appState;

// Backend session helpers
export function markBackendSessionLost() {
  appState.backend.sessionExists = false;
  appState.backend.sessionCheckedAt = Date.now();
  notifyStateChange();
}
