// utils/settings-manager.js
// Settings persistence using localStorage

const STORAGE_KEY = "termnorm_settings";

/**
 * Default settings configuration
 */
export function getDefaultSettings() {
  return {
    requireServerOnline: true, // Server required for operations
    useBraveApi: true, // Use Brave Search API if configured (toggle for testing fallbacks)
    useWebSearch: true, // Enable all web search engines (disabling skips web research entirely)
  };
}

/**
 * Load settings from localStorage
 * Merges with defaults to handle missing keys
 */
export function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return getDefaultSettings();
    }

    const parsed = JSON.parse(stored);
    return { ...getDefaultSettings(), ...parsed };
  } catch (error) {
    console.warn("Failed to load settings from localStorage:", error);
    return getDefaultSettings();
  }
}

/**
 * Save a single setting to localStorage
 * Updates entire settings object atomically
 */
export function saveSetting(key, value, currentSettings) {
  try {
    const updated = { ...currentSettings, [key]: value };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated;
  } catch (error) {
    console.error("Failed to save setting to localStorage:", error);
    throw error;
  }
}

/**
 * Load available LLM providers from backend
 */
export async function loadAvailableProviders() {
  const { apiGet } = await import("./api-fetch.js");
  const response = await apiGet("/llm-providers", {}, true); // silent = true
  return response;
}

/**
 * Set LLM provider and model on backend
 */
export async function saveLlmProvider(provider, model) {
  const { apiPost } = await import("./api-fetch.js");
  const response = await apiPost("/set-llm-provider", { provider, model });
  return response;
}

/**
 * Toggle Brave Search API on backend
 */
export async function setBraveApi(enabled) {
  const { apiPost } = await import("./api-fetch.js");
  const response = await apiPost("/set-brave-api", { enabled });
  return response;
}

/**
 * Toggle web search on backend
 */
export async function setWebSearch(enabled) {
  const { apiPost } = await import("./api-fetch.js");
  const response = await apiPost("/set-web-search", { enabled });
  return response;
}
