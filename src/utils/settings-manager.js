import { apiGet, apiPut, buildUrl } from "./api-fetch.js";
import { ENDPOINTS } from "../config/config.js";
import { stateStore } from "../core/state-store.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

const STORAGE_KEY = "termnorm_settings";
export const DEFAULTS = { requireServerOnline: true, useBraveApi: true, useWebSearch: true, useLlmRanking: true };

export function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

export function saveSetting(key, value) {
  const current = stateStore.get('settings') || {};
  const updated = { ...current, [key]: value };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  stateStore.merge('settings', { ...updated, loaded: true });
  eventBus.emit(Events.SETTING_CHANGED, { key, value });
}

// Backend settings API (RESTful endpoints)
export function getBackendSettings() { return apiGet(buildUrl(ENDPOINTS.SETTINGS), {}, true); }
export function updateBackendSettings(settings, opts = {}) {
  return apiPut(buildUrl(ENDPOINTS.SETTINGS), settings, { silent: opts.silent, processingMessage: opts.processingMessage || "Updating settings" });
}

// Convenience wrappers for backward compatibility
export function loadAvailableProviders() { return getBackendSettings(); }
export function saveLlmProvider(provider, model) { return updateBackendSettings({ provider, model }); }
export function setBraveApi(enabled, opts = {}) { return updateBackendSettings({ brave_api: enabled }, opts); }
export function setWebSearch(enabled, opts = {}) { return updateBackendSettings({ web_search: enabled }, opts); }
