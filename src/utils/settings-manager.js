import { apiGet, apiPut, buildUrl } from "./api-fetch.js";
import { ENDPOINTS } from "../config/config.js";
import { getStateValue, setSettings } from "../core/state-actions.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

const STORAGE_KEY = "termnorm_settings";
export const DEFAULTS = { requireServerOnline: true, useBraveApi: true, useWebSearch: true, useLlmRanking: true, useJsFuzzy: true, usePyFuzzy: false };

export function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

export function saveSetting(key, value) {
  const current = getStateValue('settings') || {};
  const updated = { ...current, [key]: value };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  setSettings(updated);
  eventBus.emit(Events.SETTING_CHANGED, { key, value });
}

// Backend settings API (RESTful endpoints)
export function getBackendSettings() { return apiGet(buildUrl(ENDPOINTS.SETTINGS), {}, true); }
export function updateBackendSettings(settings, opts = {}) {
  return apiPut(buildUrl(ENDPOINTS.SETTINGS), settings, { silent: opts.silent, processingMessage: opts.processingMessage || "Updating settings" });
}

