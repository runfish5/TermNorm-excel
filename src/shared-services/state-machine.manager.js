/**
 * State Manager - COMPATIBILITY LAYER (CHECKPOINT 8)
 *
 * This file is now a thin wrapper around the new state-store.js.
 * It maintains backward compatibility while the codebase gradually migrates to state-actions.
 *
 * **Architecture:**
 * - Proxy intercepts all state reads/writes and delegates to stateStore
 * - Functions in this file use stateStore.merge/set for mutations
 * - Legacy code can still access state.prop.subprop (proxied to stateStore.get)
 * - All mutations flow through immutable state-store with event emissions
 *
 * **Migration Status:**
 * - ✅ State migrated to immutable store (CHECKPOINT 8)
 * - ✅ Domain layer uses state-actions (CHECKPOINTS 3-4)
 * - ✅ Event-driven architecture complete (CHECKPOINT 9)
 * - ⏳ Remaining files can migrate to state-actions incrementally
 */

import { showMessage } from "../utils/error-display.js";
import { loadSettings, saveSetting as persistSetting } from "../utils/settings-manager.js";
import { checkServerStatus, getHost, getHeaders } from "../utils/server-utilities.js";
import { apiPost } from "../utils/api-fetch.js";
import { retryWithBackoff } from "../utils/async-utils.js";
import { SESSION_RETRY, SESSION_ENDPOINTS, LOG_PREFIX, ERROR_MESSAGES } from "../config/session.config.js";

// CHECKPOINT 8: Import new state management
import { stateStore } from "../core/state-store.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

// Export state directly from store (backward compatibility)
// This allows `state.ui.currentView` etc. to work
export const state = new Proxy({}, {
  get(_, prop) {
    return stateStore.get(prop);
  },
  set(_, prop, value) {
    console.warn(`[DEPRECATED] Direct mutation: state.${prop} = ... (use state-actions instead)`);
    stateStore.set(prop, value);
    return true;
  }
});

// Legacy callbacks (now proxy to state-store subscriptions)
let stateChangeCallbacks = [];

export function onStateChange(callback) {
  stateChangeCallbacks.push(callback);
  // Also subscribe to state-store
  stateStore.subscribe(() => callback(state));
}

export function notifyStateChange() {
  // Trigger legacy callbacks
  const currentState = stateStore.getState();
  stateChangeCallbacks.forEach((cb) => {
    try {
      cb(currentState);
    } catch (error) {
      console.error('Error in state change callback:', error);
    }
  });
}

export function setConfig(config) {
  stateStore.merge('config', {
    data: config,
    loaded: true,
  });
  eventBus.emit(Events.CONFIG_LOADED, { config });
  notifyStateChange();
}

/**
 * Load Mapping Source - Simplified (stateless backend)
 */
export async function loadMappingSource(index, loadFunction, params) {
  await checkServerStatus();

  const requireServerOnline = stateStore.get('settings.requireServerOnline');
  const serverOnline = stateStore.get('server.online');

  if (requireServerOnline && !serverOnline) {
    const error = "Server connection required to load mappings (disable in Settings for offline mode)";
    showMessage(`❌ ${error}`, "error");
    throw new Error(error);
  }

  // Get or initialize source
  const sources = stateStore.get('mappings.sources') || {};
  if (!sources[index]) {
    sources[index] = { status: "idle", data: null, error: null };
    stateStore.set('mappings.sources', sources);
  }

  try {
    sources[index].status = "loading";
    sources[index].error = null;
    stateStore.set('mappings.sources', sources);
    showMessage("Loading mapping table...");

    // Execute load operation
    const result = await loadFunction(params);

    // Update source
    sources[index].status = "synced";
    sources[index].data = result;
    stateStore.set('mappings.sources', sources);

    const termCount = Object.keys(result.reverse || {}).length;

    await combineMappingSources();

    showMessage(`✅ Mapping ${index + 1} loaded (${termCount} terms)`);
    notifyStateChange();

    return result;
  } catch (error) {
    sources[index].status = "error";
    sources[index].error = error.message;
    sources[index].data = null;
    stateStore.set('mappings.sources', sources);

    showMessage(`❌ Failed to load mapping ${index + 1}: ${error.message}`, "error");
    notifyStateChange();

    throw error;
  }
}

/**
 * Initialize backend session with retry logic
 */
async function initializeBackendSessionWithRetry(terms) {
  return await retryWithBackoff(async () => await initializeBackendSession(terms), {
    maxAttempts: SESSION_RETRY.MAX_ATTEMPTS,
    delays: SESSION_RETRY.DELAYS_MS,
    onRetry: (attempt, delay) => {
      console.log(`${LOG_PREFIX.SESSION} Initialization attempt ${attempt}/${SESSION_RETRY.MAX_ATTEMPTS}`);
      console.log(`${LOG_PREFIX.SESSION} Retrying in ${delay}ms...`);
    },
    onFailure: (attempts) => {
      const errorMsg = ERROR_MESSAGES.SESSION_INIT_MAX_RETRIES(attempts);
      console.error(`${LOG_PREFIX.SESSION} ${errorMsg}`);

      stateStore.merge('session', {
        error: errorMsg,
      });
      notifyStateChange();
    },
  });
}

/**
 * Initialize backend session (single attempt)
 */
async function initializeBackendSession(terms) {
  try {
    const data = await apiPost(
      `${getHost()}${SESSION_ENDPOINTS.INIT}`,
      { terms },
      getHeaders(),
      { silent: true }
    );

    if (data) {
      console.log(`${LOG_PREFIX.SESSION} Backend session initialized with ${terms.length} terms`);
      updateSessionState(true, terms.length, null);
      return true;
    }

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
 * Update session state
 */
function updateSessionState(initialized, termCount, error) {
  stateStore.merge('session', {
    initialized,
    termCount,
    lastInitialized: initialized ? new Date().toISOString() : null,
    error,
  });
  notifyStateChange();
}

/**
 * Combine all synced mapping sources
 */
async function combineMappingSources() {
  const sources = stateStore.get('mappings.sources') || {};
  const syncedSources = Object.values(sources).filter((s) => s.status === "synced" && s.data);

  if (syncedSources.length === 0) {
    stateStore.merge('mappings', {
      combined: null,
      loaded: false,
    });
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

  stateStore.merge('mappings', {
    combined,
    loaded: true,
  });

  // Emit event
  eventBus.emit(Events.MAPPINGS_LOADED, { mappings: combined });

  // Initialize backend session
  const terms = Object.keys(combined.reverse || {});
  if (terms.length > 0) {
    const success = await initializeBackendSessionWithRetry(terms);

    if (!success) {
      showMessage(ERROR_MESSAGES.SESSION_WARNING, "error");
    }
  }
}

/**
 * Reinitialize session
 */
export async function reinitializeSession() {
  const combined = stateStore.get('mappings.combined');
  const terms = Object.keys(combined?.reverse || {});

  if (terms.length === 0) {
    console.error(`${LOG_PREFIX.SESSION} ${ERROR_MESSAGES.SESSION_REINIT_NO_TERMS}`);
    return false;
  }

  console.log(`${LOG_PREFIX.RECOVERY} Auto-reinitializing session after session loss`);
  return await initializeBackendSessionWithRetry(terms);
}

/**
 * Clear all mappings
 */
export function clearMappings() {
  stateStore.merge('mappings', {
    sources: {},
    combined: null,
    loaded: false,
  });

  stateStore.merge('session', {
    initialized: false,
    termCount: 0,
    error: null,
  });

  eventBus.emit(Events.MAPPINGS_CLEARED);
  notifyStateChange();
}

/**
 * Initialize settings from localStorage
 */
export function initializeSettings() {
  const settings = loadSettings();
  stateStore.merge('settings', {
    ...settings,
    loaded: true,
  });
  notifyStateChange();
  return settings;
}

/**
 * Save setting
 */
export function saveSetting(key, value) {
  const currentSettings = stateStore.get('settings') || {};
  const updated = persistSetting(key, value, currentSettings);

  stateStore.merge('settings', {
    ...updated,
    loaded: true,
  });

  eventBus.emit(Events.SETTING_CHANGED, { key, value });
  notifyStateChange();
}
