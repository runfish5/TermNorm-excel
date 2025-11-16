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
import { retryWithBackoff } from "../utils/async-utils.js";
import { SESSION_RETRY, SESSION_ENDPOINTS, LOG_PREFIX, ERROR_MESSAGES } from "../config/session.config.js";

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
  session: {
    initialized: false,
    termCount: 0,
    lastInitialized: null,
    error: null,
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
 * Initialize backend session with retry logic and exponential backoff
 *
 * @param {string[]} terms - Array of terms to initialize in backend session
 * @returns {Promise<boolean>} True if initialization succeeded, false otherwise
 */
async function initializeBackendSessionWithRetry(terms) {
  return await retryWithBackoff(
    async () => await initializeBackendSession(terms),
    {
      maxAttempts: SESSION_RETRY.MAX_ATTEMPTS,
      delays: SESSION_RETRY.DELAYS_MS,
      onRetry: (attempt, delay) => {
        console.log(`${LOG_PREFIX.SESSION} Initialization attempt ${attempt}/${SESSION_RETRY.MAX_ATTEMPTS}`);
        console.log(`${LOG_PREFIX.SESSION} Retrying in ${delay}ms...`);
      },
      onFailure: (attempts) => {
        const errorMsg = ERROR_MESSAGES.SESSION_INIT_MAX_RETRIES(attempts);
        console.error(`${LOG_PREFIX.SESSION} ${errorMsg}`);
        appState.session.error = errorMsg;
        notifyStateChange();
      }
    }
  );
}

/**
 * Initialize backend session with terms array (single attempt)
 *
 * @param {string[]} terms - Array of terms to initialize in backend session
 * @returns {Promise<boolean>} True if initialization succeeded, false otherwise
 */
async function initializeBackendSession(terms) {
  try {
    const data = await apiPost(
      `${getHost()}${SESSION_ENDPOINTS.INIT}`,
      { terms },
      getHeaders(),
      { silent: true }  // Don't show loading/success messages during mapping load
    );

    if (data) {
      console.log(`${LOG_PREFIX.SESSION} Backend session initialized with ${terms.length} terms`);
      updateSessionState(true, terms.length, null);
      return true;
    }

    // apiPost returns null on failure instead of throwing
    console.error(`${LOG_PREFIX.SESSION} ${ERROR_MESSAGES.SESSION_INIT_FAILED}`);
    updateSessionState(false, 0, ERROR_MESSAGES.SESSION_INIT_FAILED);
    return false;

  } catch (error) {
    const errorMsg = `${ERROR_MESSAGES.SESSION_INIT_FAILED}: ${error.message}`;
    console.error(`${LOG_PREFIX.SESSION} ${errorMsg}`);
    updateSessionState(false, 0, errorMsg);
    return false;
  }
}

/**
 * Update session state and notify listeners
 *
 * @param {boolean} initialized - Whether session is initialized
 * @param {number} termCount - Number of terms in session
 * @param {string|null} error - Error message if any
 */
function updateSessionState(initialized, termCount, error) {
  appState.session.initialized = initialized;
  appState.session.termCount = termCount;
  appState.session.lastInitialized = initialized ? new Date() : null;
  appState.session.error = error;
  notifyStateChange();
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

  // Initialize backend session with terms (with retry logic)
  const terms = Object.keys(combined.reverse || {});
  if (terms.length > 0) {
    const success = await initializeBackendSessionWithRetry(terms);

    if (!success) {
      // Show error to user - session init failed but frontend caching still works
      showMessage(ERROR_MESSAGES.SESSION_WARNING, "error");
    }
  }
}

/**
 * Export session initialization for external use (e.g., auto-recovery in normalizer)
 *
 * @returns {Promise<boolean>} True if reinitialization succeeded, false otherwise
 */
export async function reinitializeSession() {
  const terms = Object.keys(appState.mappings.combined?.reverse || {});

  if (terms.length === 0) {
    console.error(`${LOG_PREFIX.SESSION} ${ERROR_MESSAGES.SESSION_REINIT_NO_TERMS}`);
    return false;
  }

  console.log(`${LOG_PREFIX.RECOVERY} Auto-reinitializing session after session loss`);
  return await initializeBackendSessionWithRetry(terms);
}

/**
 * Clear all mapping sources
 */
export function clearMappings() {
  appState.mappings.sources = {};
  appState.mappings.combined = null;
  appState.mappings.loaded = false;

  // Clear session state when mappings are cleared
  appState.session.initialized = false;
  appState.session.termCount = 0;
  appState.session.error = null;

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
