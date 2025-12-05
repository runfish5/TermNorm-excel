/** State Manager - Business logic for mappings, sessions, and settings */
import { showMessage } from "../utils/error-display.js";
import { loadSettings, saveSetting as persistSetting } from "../utils/settings-manager.js";
import { checkServerStatus, getHost, getHeaders } from "../utils/server-utilities.js";
import { apiPost } from "../utils/api-fetch.js";
import { SESSION_RETRY, SESSION_ENDPOINTS } from "../config/session.config.js";
import { stateStore } from "../core/state-store.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

export async function loadMappingSource(index, loadFn, params) {
  await checkServerStatus();
  if (stateStore.get('settings.requireServerOnline') && !stateStore.get('server.online')) throw (showMessage("❌ Server required", "error"), new Error("Server required"));

  const update = (u) => { const s = { ...stateStore.get('mappings.sources') }; s[index] = { ...s[index], ...u }; stateStore.set('mappings.sources', s); };
  update({ status: "loading", error: null });
  showMessage("Loading...");

  try {
    const result = await loadFn(params);
    update({ status: "synced", data: result });
    await combineMappingSources();
    showMessage(`✅ ${Object.keys(result.reverse || {}).length} terms loaded`);
    return result;
  } catch (e) { update({ status: "error", error: e.message, data: null }); showMessage(`❌ ${e.message}`, "error"); throw e; }
}

async function initSessionWithRetry(terms) {
  const { MAX_ATTEMPTS, DELAYS_MS } = SESSION_RETRY;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (await initSession(terms)) return true;
    if (i < MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, DELAYS_MS[i] || DELAYS_MS.at(-1)));
  }
  stateStore.merge('session', { error: "Session init failed" });
  return false;
}

async function initSession(terms) {
  try {
    if (await apiPost(`${getHost()}${SESSION_ENDPOINTS.INIT}`, { terms }, getHeaders(), { silent: true })) {
      stateStore.merge('session', { initialized: true, termCount: terms.length, lastInitialized: new Date().toISOString(), error: null });
      return true;
    }
  } catch {}
  stateStore.merge('session', { initialized: false, termCount: 0, lastInitialized: null, error: "Failed" });
  return false;
}

async function combineMappingSources() {
  const sources = stateStore.get('mappings.sources') || {}, synced = Object.values(sources).filter(s => s.status === "synced" && s.data);
  if (!synced.length) return stateStore.merge('mappings', { combined: null, loaded: false });

  const combined = { forward: {}, reverse: {}, metadata: { sources: [] } };
  synced.forEach((s, i) => { Object.assign(combined.forward, s.data.forward); Object.assign(combined.reverse, s.data.reverse); combined.metadata.sources.push({ index: i + 1, termCount: Object.keys(s.data.reverse || {}).length }); });

  stateStore.merge('mappings', { combined, loaded: true });
  eventBus.emit(Events.MAPPINGS_LOADED, { mappings: combined });

  const terms = Object.keys(combined.reverse);
  if (terms.length && !(await initSessionWithRetry(terms))) showMessage("⚠️ Session failed - LLM unavailable", "error");
}

export async function reinitializeSession() {
  const terms = Object.keys(stateStore.get('mappings.combined')?.reverse || {});
  return terms.length ? initSessionWithRetry(terms) : false;
}

export async function initializeSettings() {
  const settings = loadSettings();
  stateStore.merge('settings', { ...settings, loaded: true });

  // Sync backend-relevant settings (fire-and-forget, don't block startup)
  const { setWebSearch, setBraveApi } = await import("../utils/settings-manager.js");
  if (settings.useWebSearch === false) setWebSearch(false).catch(() => {});
  if (settings.useBraveApi === false) setBraveApi(false).catch(() => {});

  return settings;
}

export function saveSetting(key, value) {
  const updated = persistSetting(key, value, stateStore.get('settings') || {});
  stateStore.merge('settings', { ...updated, loaded: true });
  eventBus.emit(Events.SETTING_CHANGED, { key, value });
}
