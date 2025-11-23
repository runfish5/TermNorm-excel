/**
 * Result Accessor Service
 * Abstracts result data retrieval from multiple sources (cellState, history cache)
 * Prepares for future architectural shift where cellState stores lightweight references
 */

import { getCellState } from "./live.tracker.js";
import { getHistoryEntry } from "./history-store.js";

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
 * Fetches from history cache (backend match database)
 *
 * @param {string} identifier - Target identifier
 * @returns {Promise<Object|null>} Entry with entity_profile, aliases, web_sources, or null
 */
export async function getResultForIdentifier(identifier) {
  if (!identifier) return null;

  return await getHistoryEntry(identifier);
}

/**
 * Get result data from any source (cell key or identifier)
 * Tries cellState first, then history cache
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

  // Fallback to history cache
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
