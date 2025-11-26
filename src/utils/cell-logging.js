// utils/cell-logging.js - Centralized cell state and activity logging
import { add as addActivity } from "../ui-components/ActivityFeedUI.js";

/**
 * Log cell processing result to state and activity feed
 *
 * @param {Map} cellStateMap - Cell state map for the workbook
 * @param {string} outputCellKey - Cell key for output column (e.g., "5:3")
 * @param {string} inputValue - Original input value
 * @param {Object} result - Match result object
 * @param {string} status - Cell status: "complete" | "error"
 * @param {number} row - Row index
 * @param {number} outputCol - Output column index
 */
export function logCellResult(cellStateMap, outputCellKey, inputValue, result, status, row, outputCol) {
  // Store result in unified cell state (using OUTPUT cell key)
  cellStateMap.set(outputCellKey, {
    value: inputValue,
    result,
    status,
    row,
    col: outputCol, // Output column, not input
    timestamp: result.timestamp,
  });

  // Add activity with output cell key (enables selection lookup)
  addActivity(inputValue, outputCellKey, result.timestamp, result);
}
