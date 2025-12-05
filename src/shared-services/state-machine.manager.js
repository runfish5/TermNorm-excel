/**
 * State Manager - Business Logic Layer
 *
 * CHECKPOINT 11.3: Cleaned up dead code and legacy compatibility layer.
 * Now focuses on complex business logic:
 * - Mapping source management (loadMappingSource, combineMappingSources)
 * - Backend session initialization (reinitializeSession)
 * - Settings persistence (initializeSettings, saveSetting)
 * - Configuration loading (setConfig)
 *
 * **Architecture:**
 * - Error-throwing state Proxy enforces migration to state-actions
 * - Complex business logic remains here (session management, mapping merging)
 * - Simple mutations delegated to state-actions.js
 * - All state changes emit events for reactive UI
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

// Export state Proxy - throws errors to enforce event-driven architecture
// All state access must use getStateValue() from state-actions.js
// All state mutations must use state-actions.js functions
export const state = new Proxy({}, {
  get(_, prop) {
    console.error(`[ERROR] Direct state access deprecated: state.${prop} (use getStateValue('${prop}') instead)`);
    throw new Error(`Direct state access is no longer supported. Use getStateValue('${prop}') from state-actions.js`);
  },
  set(_, prop, value) {
    console.error(`[ERROR] Direct state mutation deprecated: state.${prop} = ... (use state-actions instead)`);
    throw new Error('Direct state mutations are no longer supported. Use state-actions.js');
  }
});

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

    return result;
  } catch (error) {
    sources[index].status = "error";
    sources[index].error = error.message;
    sources[index].data = null;
    stateStore.set('mappings.sources', sources);

    showMessage(`❌ Failed to load mapping ${index + 1}: ${error.message}`, "error");

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
    onRetry: () => {
      // Silent retry - errors logged on final failure
    },
    onFailure: (attempts) => {
      const errorMsg = ERROR_MESSAGES.SESSION_INIT_MAX_RETRIES(attempts);
      console.error(`${LOG_PREFIX.SESSION} ${errorMsg}`);

      stateStore.merge('session', {
        error: errorMsg,
      });
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

  return await initializeBackendSessionWithRetry(terms);
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
}
