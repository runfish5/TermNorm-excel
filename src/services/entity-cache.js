/**
 * Entity Cache Service
 * Abstracts access to entity database (from backend cache)
 * Prepares for future architectural shift to include session entries
 */

import { state } from "../shared-services/state-machine.manager.js";
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
  const cached = state.history.entries[identifier];
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
  return state.history.entries || {};
}

/**
 * Check if entity cache is initialized
 *
 * @returns {boolean} True if cache is ready
 */
export function isCacheReady() {
  return state.history.cacheInitialized || false;
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

  for (const [identifier, entry] of Object.entries(state.history.entries)) {
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

  // Initialize entry if doesn't exist
  if (!state.history.entries[target]) {
    state.history.entries[target] = {
      entity_profile: entity_profile || null,
      aliases: {},
      web_sources: web_sources || [],
      last_updated: timestamp,
    };
  }

  // Add this source as an alias
  state.history.entries[target].aliases[source] = {
    method,
    confidence,
    timestamp,
  };

  // Update metadata if newer
  const entry = state.history.entries[target];
  if (!entry.last_updated || timestamp > entry.last_updated) {
    entry.last_updated = timestamp;
    if (entity_profile) entry.entity_profile = entity_profile;
    if (web_sources?.length) entry.web_sources = web_sources;
  }

  console.log(`[EntityCache] Cached entity: ${source} → ${target} (${method})`);
}
