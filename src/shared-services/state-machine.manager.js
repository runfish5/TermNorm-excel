/** State Manager - Business logic for mappings, sessions, and settings */

import { showMessage } from "../utils/error-display.js";
import { loadSettings, saveSetting as persistSetting } from "../utils/settings-manager.js";
import { checkServerStatus, getHost, getHeaders } from "../utils/server-utilities.js";
import { apiPost } from "../utils/api-fetch.js";
import { SESSION_RETRY, SESSION_ENDPOINTS, LOG_PREFIX, ERROR_MESSAGES } from "../config/session.config.js";
import { stateStore } from "../core/state-store.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

// Legacy state access throws - use getStateValue()/state-actions.js instead
export const state = new Proxy({}, {
  get(_, p) { throw new Error(`Use getStateValue('${p}') instead of state.${p}`); },
  set() { throw new Error('Use state-actions.js for mutations'); }
});

/** Load mapping source with server check */
export async function loadMappingSource(index, loadFunction, params) {
  await checkServerStatus();

  if (stateStore.get('settings.requireServerOnline') && !stateStore.get('server.online')) {
    const error = "Server connection required to load mappings (disable in Settings for offline mode)";
    showMessage(`❌ ${error}`, "error");
    throw new Error(error);
  }

  const updateSource = (updates) => {
    const sources = { ...stateStore.get('mappings.sources') };
    sources[index] = { ...sources[index], ...updates };
    stateStore.set('mappings.sources', sources);
  };

  updateSource({ status: "loading", error: null });
  showMessage("Loading mapping table...");

  try {
    const result = await loadFunction(params);
    updateSource({ status: "synced", data: result });
    await combineMappingSources();
    showMessage(`✅ Mapping ${index + 1} loaded (${Object.keys(result.reverse || {}).length} terms)`);
    return result;
  } catch (error) {
    updateSource({ status: "error", error: error.message, data: null });
    showMessage(`❌ Failed to load mapping ${index + 1}: ${error.message}`, "error");
    throw error;
  }
}

/** Initialize backend session with retry */
async function initializeBackendSessionWithRetry(terms) {
  const { maxAttempts, delays } = { maxAttempts: SESSION_RETRY.MAX_ATTEMPTS, delays: SESSION_RETRY.DELAYS_MS };
  for (let i = 0; i < maxAttempts; i++) {
    if (await initializeBackendSession(terms)) return true;
    if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, delays[i] || delays[delays.length - 1]));
  }
  const errorMsg = ERROR_MESSAGES.SESSION_INIT_MAX_RETRIES(maxAttempts);
  console.error(`${LOG_PREFIX.SESSION} ${errorMsg}`);
  stateStore.merge('session', { error: errorMsg });
  return false;
}

/** Initialize backend session (single attempt) */
async function initializeBackendSession(terms) {
  try {
    const data = await apiPost(`${getHost()}${SESSION_ENDPOINTS.INIT}`, { terms }, getHeaders(), { silent: true });
    if (data) {
      stateStore.merge('session', { initialized: true, termCount: terms.length, lastInitialized: new Date().toISOString(), error: null });
      return true;
    }
  } catch (error) {
    console.error(`${LOG_PREFIX.SESSION} ${ERROR_MESSAGES.SESSION_INIT_FAILED}: ${error.message}`);
  }
  stateStore.merge('session', { initialized: false, termCount: 0, lastInitialized: null, error: ERROR_MESSAGES.SESSION_INIT_FAILED });
  return false;
}

/** Combine all synced mapping sources */
async function combineMappingSources() {
  const sources = stateStore.get('mappings.sources') || {};
  const synced = Object.values(sources).filter(s => s.status === "synced" && s.data);

  if (synced.length === 0) {
    stateStore.merge('mappings', { combined: null, loaded: false });
    return;
  }

  const combined = { forward: {}, reverse: {}, metadata: { sources: [] } };
  synced.forEach((s, i) => {
    Object.assign(combined.forward, s.data.forward);
    Object.assign(combined.reverse, s.data.reverse);
    combined.metadata.sources.push({ index: i + 1, termCount: Object.keys(s.data.reverse || {}).length });
  });

  stateStore.merge('mappings', { combined, loaded: true });
  eventBus.emit(Events.MAPPINGS_LOADED, { mappings: combined });

  const terms = Object.keys(combined.reverse);
  if (terms.length > 0 && !(await initializeBackendSessionWithRetry(terms))) {
    showMessage(ERROR_MESSAGES.SESSION_WARNING, "error");
  }
}

/** Reinitialize session with current mappings */
export async function reinitializeSession() {
  const terms = Object.keys(stateStore.get('mappings.combined')?.reverse || {});
  if (terms.length === 0) {
    console.error(`${LOG_PREFIX.SESSION} ${ERROR_MESSAGES.SESSION_REINIT_NO_TERMS}`);
    return false;
  }
  return initializeBackendSessionWithRetry(terms);
}

/** Initialize settings from localStorage */
export function initializeSettings() {
  const settings = loadSettings();
  stateStore.merge('settings', { ...settings, loaded: true });
  return settings;
}

/** Save setting to localStorage and state */
export function saveSetting(key, value) {
  const updated = persistSetting(key, value, stateStore.get('settings') || {});
  stateStore.merge('settings', { ...updated, loaded: true });
  eventBus.emit(Events.SETTING_CHANGED, { key, value });
}
