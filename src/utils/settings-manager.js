// utils/settings-manager.js - Settings persistence using localStorage

const STORAGE_KEY = "termnorm_settings";
const DEFAULTS = { requireServerOnline: true, useBraveApi: true, useWebSearch: true };

export function getDefaultSettings() { return { ...DEFAULTS }; }

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

export async function loadAvailableProviders() {
  const { apiGet } = await import("./api-fetch.js");
  return apiGet("/llm-providers", {}, true);
}

export async function saveLlmProvider(provider, model) {
  const { apiPost } = await import("./api-fetch.js");
  return apiPost("/set-llm-provider", { provider, model });
}

export async function setBraveApi(enabled) {
  const { apiPost } = await import("./api-fetch.js");
  return apiPost("/set-brave-api", { enabled });
}

export async function setWebSearch(enabled) {
  const { apiPost } = await import("./api-fetch.js");
  return apiPost("/set-web-search", { enabled });
}
