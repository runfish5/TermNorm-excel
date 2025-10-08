/**
 * State Manager - Frontend-Only State with Stateless Backend
 *
 * Architecture:
 * 1. Frontend caches mappings in memory for fast exact/fuzzy matching
 * 2. Backend receives terms array with each /research-and-match request
 * 3. Backend creates TokenLookupMatcher on-the-fly, uses it, discards it
 * 4. Simple loading states: idle → loading → synced | error
 * 5. No backend sessions, no TTL, no health checks
 */

import { showMessage } from "../utils/error-display.js";
import { loadSettings, saveSetting as persistSetting } from "../utils/settings-manager.js";
import { checkServerStatus } from "../utils/server-utilities.js";

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
    lastChecked: null,
    info: {},  // Server connection info (provider, environment, etc.)
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
  settings: {
    requireServerOnline: true,  // Default: server required for operations
    loaded: false,
  },
};

let stateChangeCallbacks = [];

export function onStateChange(callback) {
  stateChangeCallbacks.push(callback);
}

export function notifyStateChange() {
  stateChangeCallbacks.forEach((cb) => cb(appState));
}

export function setConfig(config) {
  appState.config.data = config;
  appState.config.loaded = true;
  notifyStateChange();
}

/**
 * Load Mapping Source - Simplified (stateless backend)
 *
 * Steps:
 * 1. Set status to loading
 * 2. Load data from Excel
 * 3. Cache result in frontend state
 * 4. Combine all sources
 */
export async function loadMappingSource(index, loadFunction, params) {
  await checkServerStatus();

  if (appState.settings.requireServerOnline && !appState.server.online) {
    const error = "Server connection required to load mappings (disable in Settings for offline mode)";
    showMessage(`❌ ${error}`, "error");
    throw new Error(error);
  }

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
    source.status = "loading";
    source.error = null;
    showMessage("Loading mapping table...");

    // Execute load operation (reads Excel only - no backend sync)
    const result = await loadFunction(params);

    // Update frontend cache
    source.status = "synced";
    source.data = result;

    const termCount = Object.keys(result.reverse || {}).length;

    combineMappingSources();

    showMessage(`✅ Mapping ${index + 1} loaded (${termCount} terms)`);
    notifyStateChange();

    return result;
  } catch (error) {
    source.status = "error";
    source.error = error.message;
    source.data = null;

    showMessage(`❌ Failed to load mapping ${index + 1}: ${error.message}`, "error");
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
 * Clear all mapping sources
 */
export function clearMappings() {
  appState.mappings.sources = {};
  appState.mappings.combined = null;
  appState.mappings.loaded = false;
  notifyStateChange();
}

/**
 * Initialize settings from localStorage
 * Call this during app startup
 */
export function initializeSettings() {
  const settings = loadSettings();
  appState.settings = { ...settings, loaded: true };
  notifyStateChange();
  return settings;
}

/**
 * Update a single setting and persist to localStorage
 */
export function saveSetting(key, value) {
  const updated = persistSetting(key, value, appState.settings);
  appState.settings = { ...updated, loaded: true };
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
