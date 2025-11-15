/**
 * State Manager - Frontend State with Session-Based Backend
 *
 * Architecture:
 * 1. Frontend caches mappings in memory for fast exact/fuzzy matching
 * 2. Frontend initializes backend session with terms array when mappings load
 * 3. Backend stores terms in user session, subsequent requests are lightweight
 * 4. Simple loading states: idle → loading → synced | error
 */

import { showMessage } from "../utils/error-display.js";
import { loadSettings, saveSetting as persistSetting } from "../utils/settings-manager.js";
import { checkServerStatus, getHost, getHeaders } from "../utils/server-utilities.js";
import { apiPost } from "../utils/api-fetch.js";

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
  webSearch: {
    status: "idle",  // "idle" | "success" | "failed"
    error: null,     // Error message from last failed search
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

    await combineMappingSources();

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
 * Initialize backend session with terms array
 */
async function initializeBackendSession(terms) {
  try {
    const data = await apiPost(
      `${getHost()}/session/init-terms`,
      { terms },
      getHeaders()
    );

    if (data) {
      console.log(`Backend session initialized with ${terms.length} terms`);
      return true;
    }
  } catch (error) {
    console.warn("Failed to initialize backend session:", error.message);
    // Non-fatal - backend operations will fail but frontend caching still works
    return false;
  }
}

/**
 * Combine all synced mapping sources into frontend cache
 * Also initializes backend session with terms
 */
async function combineMappingSources() {
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

  // Initialize backend session with terms
  const terms = Object.keys(combined.reverse || {});
  if (terms.length > 0) {
    await initializeBackendSession(terms);
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

// Direct state access (preferred approach per architecture principles)
export const state = appState;
