// utils/settings-manager.js
// Settings persistence using localStorage

const STORAGE_KEY = "termnorm_settings";

/**
 * Default settings configuration
 */
export function getDefaultSettings() {
  return {
    requireServerOnline: true,  // NEW DEFAULT: Server required for operations
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
