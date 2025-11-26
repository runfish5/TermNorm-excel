// utils/paste-detection.js - Multi-cell paste detection

/**
 * Count how many cells in a range belong to tracked columns (excluding header)
 *
 * @param {Object} range - Range object with rowIndex, columnIndex, rowCount, columnCount
 * @param {Map} columnMap - Map of input columns to output columns
 * @returns {number} Count of cells in tracked columns (excluding header row)
 */
export function countTrackedCells(range, columnMap) {
  let count = 0;

  for (let r = 0; r < range.rowCount; r++) {
    for (let c = 0; c < range.columnCount; c++) {
      const row = range.rowIndex + r;
      const col = range.columnIndex + c;

      // Count if: tracked column AND not header row
      if (row > 0 && columnMap.has(col)) {
        count++;
      }
    }
  }

  return count;
}
