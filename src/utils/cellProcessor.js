// utils/cellProcessor.js

// Inlined color utilities
function getRelevanceColor(score) {
  const s = score > 1 ? score / 100 : score;
  if (s >= 0.9) return "#C6EFCE"; // High confidence - light green
  if (s >= 0.8) return "#FFEB9C"; // Good - light yellow
  if (s >= 0.6) return "#FFD1A9"; // Medium - light orange
  if (s >= 0.2) return "#FFC7CE"; // Low - light red
  return "#E1E1E1"; // No confidence - light gray
}

const PROCESSING_COLORS = {
  PENDING: "#FFFB9D", // Light yellow for pending
  ERROR: "#FFC7CE", // Light red for errors
  CLEAR: null, // Clear formatting
};

/**
 * Pure function to create cell update operations
 * @param {*} value - Source cell value
 * @param {Object} result - Processing result
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @param {number} targetCol - Target column index
 * @returns {Object} Cell update operations
 */
export function createCellUpdates(value, result, row, col, targetCol) {
  const target = result?.target || "No matches found";
  const confidence = result?.confidence || 0;
  const method = result?.method || (result ? "match" : "no_match");

  return {
    value,
    target,
    method,
    confidence,
    sourceCell: { row, col, color: null }, // Clear source formatting
    targetCell: { row: row, col: targetCol, value: target, color: getRelevanceColor(confidence) },
    metadata: {
      candidates: result?.candidates,
      total_time: result?.total_time || 0,
      llm_provider: result?.llm_provider,
    },
  };
}

/**
 * Pure function to create error cell updates
 * @param {*} value - Source cell value
 * @param {Error} error - Error object
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @param {number} targetCol - Target column index
 * @returns {Object} Error cell update operations
 */
export function createErrorUpdates(value, error, row, col, targetCol) {
  const errorMsg = error instanceof Error ? error.message : String(error);

  return {
    value,
    target: errorMsg,
    method: "error",
    confidence: 0,
    sourceCell: { row, col, color: PROCESSING_COLORS.ERROR },
    targetCell: { row: row, col: targetCol, value: errorMsg, color: PROCESSING_COLORS.ERROR },
    metadata: {
      total_time: 0,
      llm_provider: undefined,
    },
  };
}

/**
 * Pure function to create user choice updates
 * @param {*} value - Source cell value
 * @param {Object} choice - User's choice
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @param {number} targetCol - Target column index
 * @returns {Object} Choice cell update operations
 */
export function createChoiceUpdates(value, choice, row, col, targetCol) {
  return {
    value,
    target: choice.candidate,
    method: "UserChoice",
    confidence: choice.relevance_score,
    sourceCell: { row, col, color: null }, // Clear source formatting
    targetCell: { row: row, col: targetCol, value: choice.candidate, color: getRelevanceColor(choice.relevance_score) },
    metadata: {
      total_time: 0,
      llm_provider: undefined,
    },
  };
}

/**
 * Apply cell updates to Excel worksheet
 * @param {Object} ws - Excel worksheet
 * @param {Object} updates - Cell update operations
 * @returns {Promise<void>}
 */
export async function applyCellUpdates(ws, updates) {
  const { sourceCell, targetCell } = updates;

  const srcCell = ws.getRangeByIndexes(sourceCell.row, sourceCell.col, 1, 1);
  const tgtCell = ws.getRangeByIndexes(targetCell.row, targetCell.col, 1, 1);

  // Update target cell
  tgtCell.values = [[targetCell.value]];
  if (targetCell.color) {
    tgtCell.format.fill.color = targetCell.color;
  }

  // Update source cell
  if (sourceCell.color) {
    srcCell.format.fill.color = sourceCell.color;
  } else {
    srcCell.format.fill.clear();
  }
}

/**
 * Mark cell as pending processing
 * @param {Object} ws - Excel worksheet
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @returns {void}
 */
export function markCellPending(ws, row, col) {
  ws.getRangeByIndexes(row, col, 1, 1).format.fill.color = PROCESSING_COLORS.PENDING;
}
