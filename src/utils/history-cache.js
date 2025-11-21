/**
 * History Cache - Fetches and caches processed entries from backend
 *
 * Called when server transitions from offline → online to populate
 * the history view with previously processed matches.
 */

import { state, notifyStateChange } from "../shared-services/state-machine.manager.js";
import { getHost, getHeaders } from "./server-utilities.js";
import { populateFromCache } from "../ui-components/ActivityFeedUI.js";

/**
 * Initialize history cache from backend if not already initialized.
 * Fetches processed entries (source→target mappings with profiles)
 * and stores them in state.history.entries.
 *
 * @returns {Promise<boolean>} True if cache was initialized or already exists
 */
export async function initializeHistoryCache() {
  // Skip if already initialized
  if (state.history.cacheInitialized) {
    console.log("[HISTORY] Cache already initialized, skipping");
    return true;
  }

  // Skip if server is offline
  if (!state.server.online) {
    console.log("[HISTORY] Server offline, cannot initialize cache");
    return false;
  }

  try {
    const response = await fetch(`${getHost()}/history/processed-entries`, {
      method: "GET",
      headers: getHeaders()
    });

    if (!response.ok) {
      console.warn("[HISTORY] Failed to fetch processed entries:", response.status);
      return false;
    }

    const result = await response.json();

    if (result.status === "success" && result.data?.entries) {
      state.history.entries = result.data.entries;
      state.history.cacheInitialized = true;

      const entryCount = Object.keys(result.data.entries).length;
      console.log(`[HISTORY] Cache initialized with ${entryCount} entries`);

      // Populate the history view with cached entries
      populateFromCache(result.data.entries);

      notifyStateChange();
      return true;
    }

    console.warn("[HISTORY] Unexpected response format:", result);
    return false;

  } catch (error) {
    console.error("[HISTORY] Error fetching processed entries:", error);
    return false;
  }
}

/**
 * Get cached entry by identifier (target)
 * @param {string} identifier - The target identifier to look up
 * @returns {Object|null} Entry with entity_profile, aliases, web_sources, or null
 */
export function getCachedEntry(identifier) {
  return state.history.entries[identifier] || null;
}

/**
 * Check if history cache is initialized
 * @returns {boolean}
 */
export function isHistoryCacheReady() {
  return state.history.cacheInitialized;
}
