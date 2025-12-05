import { apiGet, apiPost } from "./api-fetch.js";

const STORAGE_KEY = "termnorm_settings";
const DEFAULTS = { requireServerOnline: true, useBraveApi: true, useWebSearch: true };

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

export function loadAvailableProviders() { return apiGet("/llm-providers", {}, true); }
export function saveLlmProvider(provider, model) { return apiPost("/set-llm-provider", { provider, model }); }
export function setBraveApi(enabled) { return apiPost("/set-brave-api", { enabled }); }
export function setWebSearch(enabled) { return apiPost("/set-web-search", { enabled }); }
