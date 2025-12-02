/**
 * Entity Cache Service
 * Abstracts access to entity database (from backend cache)
 * Prepares for future architectural shift to include session entries
 */

import { getStateValue } from "../core/state-actions.js";
import { stateStore } from "../core/state-store.js";
import { apiGet } from "../utils/api-fetch.js";
import { getHost } from "../utils/server-utilities.js";

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
 * Get all entities
 * Returns entire entity cache from state
 *
 * @returns {Object} All entities {identifier: {aliases, entity_profile, ...}}
 */
export function getAllEntities() {
  return getStateValue('history.entries') || {};
}

/**
 * Check if entity cache is initialized
 *
 * @returns {boolean} True if cache is ready
 */
export function isCacheReady() {
  return getStateValue('history.cacheInitialized') || false;
}

/**
 * Find target identifier by source value
 * Searches aliases in cache
 *
 * @param {string} sourceValue - Source/input value to look up
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
