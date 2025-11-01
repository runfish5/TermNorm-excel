import { add as addActivity } from "../ui-components/ActivityFeedUI.js";
import { addCandidate } from "../ui-components/CandidateRankingUI.js";
import { processTermNormalization } from "./normalizer.functions.js";
import { buildColumnMap } from "../utils/column-utilities.js";
import { createCellKey, hasValueChanged, cleanCellValue } from "../utils/cell-utilities.js";
import { getRelevanceColor, PROCESSING_COLORS, getCurrentWorkbookName } from "../utils/app-utilities.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";

// Activity logging
const sessionId = `excel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

function logActivity(source, target, method, confidence, total_time, llm_provider) {
  fetch(`${getHost()}/log-activity`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      source,
      target,
      method,
      confidence,
      total_time,
      llm_provider,
      session_id: sessionId,
    }),
  }).catch((err) => console.warn("Log failed:", err));
}

const activeTrackers = new Map();
const activationInProgress = new Set();
const processingCells = new Set();

export async function startTracking(config, mappings) {
  if (!config?.column_map || !mappings) throw new Error("Config and mappings required");

  // Get workbook identifier for this tracker instance
  const workbookId = await getCurrentWorkbookName();

  // Prevent concurrent activation for same workbook
  if (activationInProgress.has(workbookId)) {
    console.warn(`Tracking activation already in progress for ${workbookId}`);
    return;
  }

  activationInProgress.add(workbookId);

  try {
    processingCells.clear();
    const columnMap = await Excel.run(async (ctx) => {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      const usedRange = ws.getUsedRange(true);
      usedRange.load("columnIndex, columnCount");
      await ctx.sync();

      // eslint-disable-next-line office-addins/call-sync-after-load, office-addins/call-sync-before-read
      const lastCol = usedRange.columnIndex + usedRange.columnCount - 1;
      const headers = ws.getRangeByIndexes(0, 0, 1, lastCol + 1);
      headers.load("values");
      await ctx.sync();

      const headerNames = headers.values[0].map((h) => String(h || "").trim());
      return buildColumnMap(headerNames, config.column_map);
    });

    // Create tracker instance for this workbook
    const tracker = {
      active: true,
      handler: null,
      columnMap,
      cellValues: new Map(),
      mappings,
      config,
      workbookId,
    };

    // Remove existing tracker if any
    const existingTracker = activeTrackers.get(workbookId);
    if (existingTracker?.handler) {
      await Excel.run(async (ctx) => {
        const ws = ctx.workbook.worksheets.getActiveWorksheet();
        ws.onChanged.remove(existingTracker.handler);
        await ctx.sync();
      });
    }

    // Setup change handler with tracker context
    await Excel.run(async (ctx) => {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      tracker.handler = ws.onChanged.add((event) => handleWorksheetChange(event, tracker));
      await ctx.sync();
    });

    // Store tracker
    activeTrackers.set(workbookId, tracker);
    console.log(`✓ Tracking started for workbook: ${workbookId}`);
  } finally {
    activationInProgress.delete(workbookId);
  }
}

const handleWorksheetChange = async (e, tracker) => {
  if (!tracker.active) return;

  await Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const range = ws.getRange(e.address);
    range.load("values, rowIndex, columnIndex, rowCount, columnCount");
    await ctx.sync();

    // Process all cells that need mapping
    const tasks = [];

    // eslint-disable-next-line office-addins/call-sync-after-load, office-addins/call-sync-before-read
    const { rowCount, columnCount, rowIndex, columnIndex, values } = range;

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < columnCount; c++) {
        const row = rowIndex + r;
        const col = columnIndex + c;
        const targetCol = tracker.columnMap.get(col);
        const value = values[r][c];

        if (row > 0 && targetCol && value) {
          const cellKey = createCellKey(row, col);
          const cleanValue = cleanCellValue(value);

          if (processingCells.has(cellKey)) continue;

          if (hasValueChanged(tracker.cellValues, cellKey, cleanValue)) {
            tracker.cellValues.set(cellKey, cleanValue);
            processingCells.add(cellKey);
            ws.getRangeByIndexes(row, col, 1, 1).format.fill.color = PROCESSING_COLORS.PENDING;
            tasks.push(() => processCell(ws, row, col, targetCol, cleanValue, tracker, cellKey));
          }
        }
      }
    }
    await ctx.sync();

    // Execute all processing tasks
    for (const task of tasks) await task();
    await ctx.sync();
  });
};

async function processCell(ws, row, col, targetCol, value, tracker, cellKey) {
  try {
    const result = await processTermNormalization(
      value,
      tracker.mappings.forward,
      tracker.mappings.reverse
    );

    if (result?.candidates) {
      addCandidate(value, result, {
        applyChoice: (choice) => applyChoiceToCell(ws, row, col, targetCol, value, choice),
      });
    }

    const target = result?.target || "No matches found";
    const confidence = result?.confidence || 0;
    const method = result?.method || (result ? "match" : "no_match");

    await Excel.run(async (ctx) => {
      ctx.runtime.enableEvents = false;

      const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
      const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

      tgtCell.values = [[target]];
      tgtCell.format.fill.color = getRelevanceColor(confidence);
      srcCell.format.fill.clear();

      await ctx.sync();
      ctx.runtime.enableEvents = true;
    });

    addActivity(value, target, method, confidence);
    logActivity(value, target, method, confidence, result?.total_time || 0, result?.llm_provider);
  } catch (error) {
    await handleCellError(row, col, targetCol, value, error);
  } finally {
    processingCells.delete(cellKey);
  }
}

async function handleCellError(row, col, targetCol, value, error) {
  const errorMsg = error instanceof Error ? error.message : String(error);

  await Excel.run(async (ctx) => {
    ctx.runtime.enableEvents = false;

    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
    const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

    srcCell.format.fill.color = PROCESSING_COLORS.ERROR;
    tgtCell.values = [[errorMsg]];
    tgtCell.format.fill.color = PROCESSING_COLORS.ERROR;

    await ctx.sync();
    ctx.runtime.enableEvents = true;
  });

  addActivity(value, errorMsg, "error", 0);
  logActivity(value, errorMsg, "error", 0, 0, undefined);
}

async function applyChoiceToCell(ws, row, col, targetCol, value, choice) {
  await Excel.run(async (ctx) => {
    ctx.runtime.enableEvents = false;

    const activeWs = ctx.workbook.worksheets.getActiveWorksheet();
    const srcCell = activeWs.getRangeByIndexes(row, col, 1, 1);
    const tgtCell = activeWs.getRangeByIndexes(row, targetCol, 1, 1);

    tgtCell.values = [[choice.candidate]];
    tgtCell.format.fill.color = getRelevanceColor(choice.relevance_score);
    srcCell.format.fill.clear();

    await ctx.sync();
    ctx.runtime.enableEvents = true;
  });

  addActivity(value, choice.candidate, "UserChoice", choice.relevance_score);
  logActivity(value, choice.candidate, "UserChoice", choice.relevance_score, 0, undefined);
}

export async function stopTracking(workbookId) {
  if (!workbookId) {
    workbookId = await getCurrentWorkbookName();
  }

  const tracker = activeTrackers.get(workbookId);
  if (tracker) {
    tracker.active = false;

    if (tracker.handler) {
      await Excel.run(async (ctx) => {
        const ws = ctx.workbook.worksheets.getActiveWorksheet();
        ws.onChanged.remove(tracker.handler);
        await ctx.sync();
      });
    }

    activeTrackers.delete(workbookId);
    processingCells.clear();
    console.log(`✓ Tracking stopped for workbook: ${workbookId}`);
  }
}

export function getActiveTrackers() {
  return Array.from(activeTrackers.keys());
}
