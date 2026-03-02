// Workflows - Async operations, multi-step workflows, and event coordination
import { loadSettings } from "../utils/settings-manager.js";
import { checkServerStatus, getHeaders, buildUrl, fireAndForget, apiPost } from "../utils/api-fetch.js";
import { SESSION_RETRY, ENDPOINTS } from "../config/config.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { startTracking, stopTracking } from "./live-tracker.js";
import {
  setTrackingActive, getStateValue, clearWorkbookCells, clearSessionHistory,
  updateMappingSource, setSessionState, setCombinedMappings, setSettings,
} from "../core/state-actions.js";

export async function loadMappingSource(index, loadFn, params) {
  await checkServerStatus();
  if (getStateValue('settings.requireServerOnline') && !getStateValue('server.online')) throw new Error("Server required");

  updateMappingSource(index, { status: "loading", error: null });

  try {
    const result = await loadFn(params);
    updateMappingSource(index, { status: "synced", data: result });
    await combineMappingSources();
    return result;
  } catch (e) { updateMappingSource(index, { status: "error", error: e.message, data: null }); throw e; }
}

async function initSessionWithRetry(terms) {
  const { MAX_ATTEMPTS, DELAYS_MS } = SESSION_RETRY;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    if (await initSession(terms)) return true;
    if (i < MAX_ATTEMPTS - 1) await new Promise(r => setTimeout(r, DELAYS_MS[i] || DELAYS_MS.at(-1)));
  }
  setSessionState({ error: "Session init failed" });
  return false;
}

async function initSession(terms) {
  try {
    if (await apiPost(buildUrl(ENDPOINTS.SESSIONS), { terms }, getHeaders(), { silent: true })) {
      setSessionState({ initialized: true, termCount: terms.length, lastInitialized: new Date().toISOString(), error: null });
      return true;
    }
  } catch { /* API errors handled by apiPost, fall through to retry/fail */ }
  setSessionState({ initialized: false, termCount: 0, lastInitialized: null, error: "Failed" });
  return false;
}

async function combineMappingSources() {
  const sources = getStateValue('mappings.sources') || {}, synced = Object.values(sources).filter(s => s.status === "synced" && s.data);
  if (!synced.length) return setCombinedMappings(null);

  const combined = { forward: {}, reverse: {}, metadata: { sources: [] } };
  synced.forEach((s, i) => { Object.assign(combined.forward, s.data.forward); Object.assign(combined.reverse, s.data.reverse); combined.metadata.sources.push({ index: i + 1, termCount: Object.keys(s.data.reverse || {}).length }); });

  setCombinedMappings(combined);

  const terms = Object.keys(combined.reverse);
  if (terms.length && !(await initSessionWithRetry(terms))) eventBus.emit(Events.SERVICE_MESSAGE, { text: "Session failed - LLM unavailable", type: "error" });
}

export async function reinitializeSession() {
  const terms = Object.keys(getStateValue('mappings.combined')?.reverse || {});
  return terms.length ? initSessionWithRetry(terms) : false;
}

export async function ensureSessionInitialized() {
  if (getStateValue('session.initialized')) return true;
  eventBus.emit(Events.SERVICE_MESSAGE, { text: "Initializing backend session..." });
  const success = await reinitializeSession();
  if (!success) eventBus.emit(Events.SERVICE_MESSAGE, { text: "Session initialization failed - check server connection", type: "error" });
  return success;
}

export async function executeWithSessionRecovery(apiCallFn) {
  try { const result = await apiCallFn(); if (result) return result; } catch {}
  eventBus.emit(Events.SERVICE_MESSAGE, { text: "Recovering backend session..." });
  return (await reinitializeSession()) ? apiCallFn() : null;
}

export async function initializeSettings() {
  const settings = loadSettings();
  setSettings(settings);

  // Sync backend-relevant settings (fire-and-forget, don't block startup)
  const { updateBackendSettings } = await import("../utils/settings-manager.js");
  fireAndForget(updateBackendSettings({
    web_search: settings.useWebSearch !== false,
    brave_api: settings.useBraveApi !== false,
  }));

  return settings;
}

/**
 * Central tracking activation - starts tracker and sets state
 * @param {Object} config - App configuration with column_map
 * @param {Object} mappings - Combined mappings with forward/reverse
 * @returns {Promise<Object>} Tracking info (workbookId, columnCount, etc.)
 */
export async function activateTracking(config, mappings) {
  const info = await startTracking(config, mappings);
  setTrackingActive(true);
  return info;
}

/**
 * Central tracking deactivation - stops tracker, clears cells, sets state
 * Single "master switch" that controls all tracking-related state
 */
export async function deactivateTracking() {
  await stopTracking();
  // Clear all workbook cells
  const workbooks = getStateValue('session.workbooks') || {};
  for (const wbId of Object.keys(workbooks)) {
    clearWorkbookCells(wbId);
  }
  clearSessionHistory();
  setTrackingActive(false);
}

/**
 * Restart tracking - deactivate then reactivate with current config/mappings
 */
export async function restartTracking() {
  await deactivateTracking();
  const config = getStateValue('config.data');
  const mappings = getStateValue('mappings.combined');
  if (config && mappings) {
    return activateTracking(config, mappings);
  }
}
