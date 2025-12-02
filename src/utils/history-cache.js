/**
 * History Cache - Fetches and caches processed entries from backend
 *
 * Called when server transitions from offline → online to populate
 * the history view with previously processed matches.
 *
 * CHECKPOINT 5: Fixed layering violation - removed direct UI import.
 * Now uses event bus to notify UI instead of calling it directly.
 */

import { getStateValue, setHistoryEntries, setHistoryCacheInitialized } from "../core/state-actions.js";
import { getHost, getHeaders } from "./server-utilities.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

/**
 * Initialize history cache from backend if not already initialized.
 * Fetches processed entries (source→target mappings with profiles)
 * and stores them in state.history.entries.
 *
 * @returns {Promise<boolean>} True if cache was initialized or already exists
 */
export async function initializeHistoryCache() {
  // Skip if already initialized
  if (getStateValue('history.cacheInitialized')) {
    console.log("[HISTORY] Cache already initialized, skipping");
    return true;
  }

  // Skip if server is offline
  if (!getStateValue('server.online')) {
    console.log("[HISTORY] Server offline, cannot initialize cache");
    return false;
  }

  try {
    const response = await fetch(`${getHost()}/history/processed-entries`, {
      method: "GET",
      headers: getHeaders(),
    });

    if (!response.ok) {
      console.warn("[HISTORY] Failed to fetch processed entries:", response.status);
      return false;
    }

    const result = await response.json();

    if (result.status === "success" && result.data?.entries) {
      const entryCount = Object.keys(result.data.entries).length;
      console.log(`[HISTORY] Cache initialized with ${entryCount} entries`);

      setHistoryEntries(result.data.entries);
      setHistoryCacheInitialized(true, entryCount);

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
  const entries = getStateValue('history.entries') || {};
  return entries[identifier] || null;
}

/**
 * Check if history cache is initialized
 * @returns {boolean}
 */
export function isHistoryCacheReady() {
  return getStateValue('history.cacheInitialized') || false;
}

/**
 * Find target identifier by source value (searches aliases in cache)
 * Used for input column lookups when forward mapping doesn't have the value
 * @param {string} sourceValue - The source/input value to look up
 * @returns {string|null} Target identifier if found, null otherwise
 */
export function findTargetBySource(sourceValue) {
  if (!sourceValue) return null;

  const entries = getStateValue('history.entries') || {};
  for (const [identifier, entry] of Object.entries(entries)) {
    if (entry.aliases?.[sourceValue]) {
      return identifier;
    }
  }
  return null;
}
