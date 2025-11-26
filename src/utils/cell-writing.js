// utils/cell-writing.js - Centralized cell writing operations
import { getRelevanceColor } from "./app-utilities.js";

/**
 * Write match result to Excel cells (target value, colors, confidence)
 * Creates its own Excel.run context with events disabled
 *
 * @param {number} row - Row index
 * @param {number} inputCol - Input column index
 * @param {number} outputCol - Output column index
 * @param {string} targetValue - Value to write to output cell
 * @param {number} confidence - Confidence score (0.0-1.0)
 * @param {Map} confidenceColumnMap - Map of input columns to confidence columns
 */
export async function writeCellResult(row, inputCol, outputCol, targetValue, confidence, confidenceColumnMap) {
  await Excel.run(async (ctx) => {
    ctx.runtime.enableEvents = false;

    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const srcCell = ws.getRangeByIndexes(row, inputCol, 1, 1);
    const tgtCell = ws.getRangeByIndexes(row, outputCol, 1, 1);

    // Write target value and color based on confidence
    tgtCell.values = [[targetValue]];
    tgtCell.format.fill.color = getRelevanceColor(confidence);

    // Clear input cell color (processing complete)
    srcCell.format.fill.clear();

    // Write confidence value if confidence column is configured for this input column
    const confidenceCol = confidenceColumnMap.get(inputCol);
    if (confidenceCol !== undefined) {
      const confCell = ws.getRangeByIndexes(row, confidenceCol, 1, 1);
      // Convert confidence from 0.0-1.0 to 0-100 integer
      const confidencePercent = Math.round(confidence * 100);
      confCell.values = [[confidencePercent]];
    }

    await ctx.sync();
    ctx.runtime.enableEvents = true;
  });
}
