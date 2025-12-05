/** State Manager - Business logic for mappings, sessions, and settings */
import { showMessage } from "../utils/error-display.js";
import { loadSettings, saveSetting as persistSetting } from "../utils/settings-manager.js";
import { checkServerStatus, getHost, getHeaders } from "../utils/server-utilities.js";
import { apiPost } from "../utils/api-fetch.js";
import { SESSION_RETRY, SESSION_ENDPOINTS } from "../config/session.config.js";
import { stateStore } from "../core/state-store.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

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

async function initializeBackendSessionWithRetry(terms) {
  const { MAX_ATTEMPTS, DELAYS_MS } = SESSION_RETRY;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (await initializeBackendSession(terms)) return true;
    if (i < MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, DELAYS_MS[i] || DELAYS_MS.at(-1)));
  }
  stateStore.merge('session', { error: `Session init failed after ${MAX_ATTEMPTS} attempts` });
  return false;
}

async function initializeBackendSession(terms) {
  try {
    if (await apiPost(`${getHost()}${SESSION_ENDPOINTS.INIT}`, { terms }, getHeaders(), { silent: true })) {
      stateStore.merge('session', { initialized: true, termCount: terms.length, lastInitialized: new Date().toISOString(), error: null });
      return true;
    }
  } catch {}
  stateStore.merge('session', { initialized: false, termCount: 0, lastInitialized: null, error: "Session init failed" });
  return false;
}

async function combineMappingSources() {
  const sources = stateStore.get('mappings.sources') || {};
  const synced = Object.values(sources).filter(s => s.status === "synced" && s.data);
  if (!synced.length) return stateStore.merge('mappings', { combined: null, loaded: false });

  const combined = { forward: {}, reverse: {}, metadata: { sources: [] } };
  synced.forEach((s, i) => {
    Object.assign(combined.forward, s.data.forward);
    Object.assign(combined.reverse, s.data.reverse);
    combined.metadata.sources.push({ index: i + 1, termCount: Object.keys(s.data.reverse || {}).length });
  });

  stateStore.merge('mappings', { combined, loaded: true });
  eventBus.emit(Events.MAPPINGS_LOADED, { mappings: combined });

  const terms = Object.keys(combined.reverse);
  if (terms.length && !(await initializeBackendSessionWithRetry(terms))) {
    showMessage("⚠️ Backend session init failed. LLM features unavailable.", "error");
  }
}

export async function reinitializeSession() {
  const terms = Object.keys(stateStore.get('mappings.combined')?.reverse || {});
  return terms.length ? initializeBackendSessionWithRetry(terms) : false;
}

export function initializeSettings() {
  const settings = loadSettings();
  stateStore.merge('settings', { ...settings, loaded: true });
  return settings;
}

export function saveSetting(key, value) {
  const updated = persistSetting(key, value, stateStore.get('settings') || {});
  stateStore.merge('settings', { ...updated, loaded: true });
  eventBus.emit(Events.SETTING_CHANGED, { key, value });
}
