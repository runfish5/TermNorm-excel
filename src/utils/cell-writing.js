import { getRelevanceColor } from "./app-utilities.js";

export async function writeCellResult(row, inputCol, outputCol, targetValue, confidence, confidenceColumnMap) {
  await Excel.run(async (ctx) => {
    ctx.runtime.enableEvents = false;
    const ws = ctx.workbook.worksheets.getActiveWorksheet();

    ws.getRangeByIndexes(row, outputCol, 1, 1).values = [[targetValue]];
    ws.getRangeByIndexes(row, outputCol, 1, 1).format.fill.color = getRelevanceColor(confidence);
    ws.getRangeByIndexes(row, inputCol, 1, 1).format.fill.clear();

    const confCol = confidenceColumnMap.get(inputCol);
    if (confCol !== undefined) ws.getRangeByIndexes(row, confCol, 1, 1).values = [[Math.round(confidence * 100)]];

    await ctx.sync();
    ctx.runtime.enableEvents = true;
  });
}
