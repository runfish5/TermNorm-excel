/**
 * History Cache - Fetches and caches processed entries from backend
 *
 * Called when server transitions from offline → online to populate
 * the history view with previously processed matches.
 *
 * CHECKPOINT 5: Fixed layering violation - removed direct UI import.
 * Now uses event bus to notify UI instead of calling it directly.
 *
 * CHECKPOINT 11.3: Merged entity-cache.js into this file to eliminate duplication.
 * All entity cache operations (getEntity, cacheEntity) now live here.
 */

import { getStateValue, setHistoryEntries, setHistoryCacheInitialized } from "../core/state-actions.js";
import { stateStore } from "../core/state-store.js";
import { serverFetch, apiGet } from "./api-fetch.js";
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
    const response = await serverFetch("/history/processed-entries", {
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

// ============================================================================
// ENTITY CACHE OPERATIONS (merged from entity-cache.js - CHECKPOINT 11.3)
// ============================================================================

/**
 * Get entity by identifier (target)
 * Checks cache first, falls back to server request
 *
 * @param {string} identifier - Target identifier to look up
 * @returns {Promise<Object|null>} Entry with entity_profile, aliases, web_sources, or null
 */
export async function getEntity(identifier) {
  if (!identifier) return null;

  // Check local cache first
  const entries = getStateValue('history.entries') || {};
  const cached = entries[identifier];
  if (cached) {
    return cached;
  }

  // Fallback: fetch from server if not in cache
  try {
    const response = await apiGet(`${getHost()}/match-details/${encodeURIComponent(identifier)}`);

    if (!response || response.status === "error") {
      console.warn("Failed to fetch match details:", response?.message);
      return null;
    }

    return response.data;
  } catch (error) {
    console.error("Error fetching entity:", error);
    return null;
  }
}

/**
 * Cache entity in the entity cache
 * Creates unified data structure matching backend cache format
 *
 * @param {string} source - Original input value (source term)
 * @param {Object} result - Normalized result from match processing
 * @param {string} result.target - Target identifier
 * @param {string} result.method - Match method (cached/fuzzy/ProfileRank/etc)
 * @param {number} result.confidence - Match confidence (0.0-1.0)
 * @param {string} result.timestamp - ISO timestamp
 * @param {Object} result.entity_profile - Optional entity profile data
 * @param {Array} result.web_sources - Optional web sources
 */
export function cacheEntity(source, result) {
  const { target, method, confidence, timestamp, entity_profile, web_sources } = result;

  if (!target) {
    console.warn("[EntityCache] Cannot cache entity without target");
    return;
  }

  // Get current entries immutably
  const entries = getStateValue('history.entries') || {};
  const updatedEntries = { ...entries };

  // Initialize entry if doesn't exist
  if (!updatedEntries[target]) {
    updatedEntries[target] = {
      entity_profile: entity_profile || null,
      aliases: {},
      web_sources: web_sources || [],
      last_updated: timestamp,
    };
  } else {
    // Clone existing entry to maintain immutability
    updatedEntries[target] = {
      ...updatedEntries[target],
      aliases: { ...updatedEntries[target].aliases }
    };
  }

  // Add this source as an alias
  updatedEntries[target].aliases[source] = {
    method,
    confidence,
    timestamp,
  };

  // Update metadata if newer
  const entry = updatedEntries[target];
  if (!entry.last_updated || timestamp > entry.last_updated) {
    entry.last_updated = timestamp;
    if (entity_profile) entry.entity_profile = entity_profile;
    if (web_sources?.length) entry.web_sources = web_sources;
  }

  // Update state immutably
  stateStore.set('history.entries', updatedEntries);

  console.log(`[EntityCache] Cached entity: ${source} → ${target} (${method})`);
}
