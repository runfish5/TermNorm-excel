import { apiGet } from "./api-fetch.js";
import { ENDPOINTS } from "../config/config.js";
import { getHost } from "./api-fetch.js";

const STORAGE_KEY = "termnorm_settings";
export const DEFAULTS = { requireServerOnline: true, useBraveApi: true, useWebSearch: true, useLlmRanking: true };

export function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : { ...DEFAULTS };
  } catch { return { ...DEFAULTS }; }
}

export function saveSetting(key, value, currentSettings) {
  const updated = { ...currentSettings, [key]: value };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

// Backend settings API (RESTful endpoints)
export function getBackendSettings() { return apiGet(`${getHost()}${ENDPOINTS.SETTINGS}`, {}, true); }
export async function updateBackendSettings(settings, opts = {}) {
  const { silent, processingMessage } = opts;
  const url = `${getHost()}${ENDPOINTS.SETTINGS}`;
  const fetchOpts = { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings), silent };
  if (!silent) { const { showMessage } = await import("./error-display.js"); showMessage(processingMessage || "Updating settings", "processing"); }
  try {
    const response = await fetch(url, fetchOpts);
    const data = await response.json();
    if (response.ok) return data.data ?? null;
    return null;
  } catch { return null; }
}

// Convenience wrappers for backward compatibility
export function loadAvailableProviders() { return getBackendSettings(); }
export function saveLlmProvider(provider, model) { return updateBackendSettings({ provider, model }); }
export function setBraveApi(enabled, opts = {}) { return updateBackendSettings({ brave_api: enabled }, opts); }
export function setWebSearch(enabled, opts = {}) { return updateBackendSettings({ web_search: enabled }, opts); }
