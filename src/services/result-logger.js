// Result Logger - Centralized result logging (cell state + events + API)
import { setCellState } from "../core/state-actions.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { apiPost, getHeaders, buildUrl, fireAndForget } from "../utils/api-fetch.js";
import { ENDPOINTS } from "../config/config.js";

/**
 * Log a cell result: update cell state + emit MATCH_LOGGED
 * @param {string} workbookId
 * @param {string} cellKey
 * @param {string} value - Source input value
 * @param {import('../config/config.js').MatchResult} result
 * @param {string} status - 'complete' | 'error'
 * @param {number} row
 * @param {number} col
 */
export function logCellResult(workbookId, cellKey, value, result, status, row, col) {
  setCellState(workbookId, cellKey, { value, result, status, row, col, timestamp: result.timestamp });
  eventBus.emit(Events.MATCH_LOGGED, { value, cellKey, timestamp: result.timestamp, result });
}

/**
 * Log a match result: emit MATCH_LOGGED only (no cell state mutation)
 * Used by direct-prompt and direct-edit flows where cell state is managed elsewhere.
 * @param {string} value - Source input value
 * @param {string} cellKey
 * @param {{ target: string, method: string, confidence: number }} result
 */
export function logMatchResult(value, cellKey, result) {
  eventBus.emit(Events.MATCH_LOGGED, {
    value, cellKey, timestamp: new Date().toISOString(),
    result: { ...result, web_search_status: "idle" },
  });
}

/**
 * Post an activity record to the backend (fire-and-forget)
 * @param {string} source
 * @param {string} target
 * @param {string} method
 * @param {number} confidence
 * @param {string} [timestamp]
 */
export function postActivity(source, target, method, confidence, timestamp) {
  fireAndForget(apiPost(buildUrl(ENDPOINTS.ACTIVITIES), {
    source, target, method, confidence, timestamp: timestamp || new Date().toISOString(),
  }, getHeaders()));
}
