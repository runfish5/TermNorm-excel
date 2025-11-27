/**
 * Result Lookup Service
 * Abstracts result data retrieval from multiple sources (cellState, entity cache)
 * Prepares for future architectural shift where cellState stores lightweight references
 */

import { getCellState } from "./live.tracker.js";
import { getEntity } from "./entity-cache.js";

/**
 * Get complete result data for a cell
 * Checks current session (cellState) first
 *
 * @param {string} cellKey - Cell key (row:col format)
 * @returns {Object|null} Complete result object or null
 */
export function getResultForCell(cellKey) {
  if (!cellKey) return null;

  const state = getCellState(cellKey);
  return state?.result || null;
}

/**
 * Get complete result data by identifier
 * Fetches from entity cache (backend match database)
 *
 * @param {string} identifier - Target identifier
 * @returns {Promise<Object|null>} Entry with entity_profile, aliases, web_sources, or null
 */
export async function getResultForIdentifier(identifier) {
  if (!identifier) return null;

  return await getEntity(identifier);
}

/**
 * Get result data from any source (cell key or identifier)
 * Tries cellState first, then entity cache
 *
 * @param {string} cellKey - Cell key (row:col format) or null
 * @param {string} identifier - Target identifier or null
 * @returns {Promise<Object|null>} Result object from any available source
 */
export async function getResultFromAnywhere(cellKey, identifier) {
  // Try cellState first (current session)
  if (cellKey) {
    const cellResult = getResultForCell(cellKey);
    if (cellResult) return cellResult;
  }

  // Fallback to entity cache
  if (identifier) {
    return await getResultForIdentifier(identifier);
  }

  return null;
}

/**
 * Check if a cell has result data
 *
 * @param {string} cellKey - Cell key (row:col format)
 * @returns {boolean} True if cell has result data
 */
export function hasResult(cellKey) {
  if (!cellKey) return false;

  const state = getCellState(cellKey);
  return state?.result != null && state?.status === "complete";
}
