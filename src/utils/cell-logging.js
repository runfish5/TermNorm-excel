// utils/cell-logging.js - Centralized cell state and history logging
import { setCellState } from "../core/state-actions.js";
import { addEntry as addHistoryEntry } from "../ui-components/ProcessingHistoryUI.js";

/**
 * Log cell processing result to state and activity feed
 *
 * @param {string} workbookId - Workbook identifier
 * @param {string} outputCellKey - Cell key for output column (e.g., "5:3")
 * @param {string} inputValue - Original input value
 * @param {Object} result - Match result object
 * @param {string} status - Cell status: "complete" | "error"
 * @param {number} row - Row index
 * @param {number} outputCol - Output column index
 */
export function logCellResult(workbookId, outputCellKey, inputValue, result, status, row, outputCol) {
  // Store result in unified cell state (using OUTPUT cell key)
  setCellState(workbookId, outputCellKey, {
    value: inputValue,
    result,
    status,
    row,
    col: outputCol, // Output column, not input
    timestamp: result.timestamp,
  });

  // Add history entry with output cell key (enables selection lookup)
  addHistoryEntry(inputValue, outputCellKey, result.timestamp, result);
}
