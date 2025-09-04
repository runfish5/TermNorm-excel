// utils/cellUtils.js

/**
 * Generate cell key for tracking
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @returns {string} Cell key in format "row:col"
 */
export function createCellKey(row, col) {
  return `${row}:${col}`;
}

/**
 * Parse cell address into row and column
 * @param {string} address - Excel address like "A1" or "B2:C3"
 * @returns {Object} Object with startRow, startCol, endRow, endCol
 */
export function parseCellAddress(address) {
  // Simple parser for basic addresses
  const match = address.match(/([A-Z]+)(\d+)/);
  if (!match) return null;

  const col = match[1].split("").reduce((result, char) => result * 26 + char.charCodeAt(0) - 64, 0) - 1;
  const row = parseInt(match[2]) - 1;

  return { startRow: row, startCol: col, endRow: row, endCol: col };
}

/**
 * Check if cell value has actually changed
 * @param {Map} cellValues - Map tracking previous cell values
 * @param {string} cellKey - Cell key
 * @param {*} newValue - New cell value
 * @returns {boolean} True if value changed
 */
export function hasValueChanged(cellValues, cellKey, newValue) {
  const oldValue = cellValues.get(cellKey);
  return oldValue !== newValue;
}

/**
 * Clean and normalize cell value
 * @param {*} value - Raw cell value
 * @returns {string} Cleaned string value
 */
export function cleanCellValue(value) {
  return String(value || "").trim();
}
