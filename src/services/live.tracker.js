import { add as addActivity } from "../ui-components/ActivityFeedUI.js";
import { addCandidate } from "../ui-components/CandidateRankingUI.js";
import { processTermNormalization } from "./normalizer.functions.js";
import { buildColumnMap } from "../utils/column-utilities.js";
import { createCellKey, hasValueChanged, cleanCellValue } from "../utils/cell-utilities.js";
import { getRelevanceColor, PROCESSING_COLORS, getCurrentWorkbookName } from "../utils/app-utilities.js";
const activeTrackers = new Map();
const activationInProgress = new Set();
// Unified cell state: cellKey → {value, result, status, row, col, targetCol, timestamp}
const cellState = new Map();

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
    cellState.clear();
    const columnMap = await Excel.run(async (ctx) => {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      ws.load("name");
      const usedRange = ws.getUsedRange(true);
      usedRange.load("columnIndex, columnCount");
      await ctx.sync();

      // eslint-disable-next-line office-addins/call-sync-after-load, office-addins/call-sync-before-read
      const lastCol = usedRange.columnIndex + usedRange.columnCount - 1;
      // eslint-disable-next-line office-addins/call-sync-after-load, office-addins/call-sync-before-read
      const worksheetName = ws.name; // Read after sync
      const headers = ws.getRangeByIndexes(0, 0, 1, lastCol + 1);
      headers.load("values");
      await ctx.sync();

      const headerNames = headers.values[0].map((h) => String(h || "").trim());
      return buildColumnMap(headerNames, config.column_map, worksheetName);
    });

    // Create tracker instance for this workbook
    const tracker = {
      active: true,
      handler: null,
      selectionHandler: null,
      columnMap,
      mappings,
      config,
      workbookId,
    };

    // Remove existing tracker if any
    const existingTracker = activeTrackers.get(workbookId);
    if (existingTracker?.handler || existingTracker?.selectionHandler) {
      await Excel.run(async (ctx) => {
        const ws = ctx.workbook.worksheets.getActiveWorksheet();
        if (existingTracker.handler) ws.onChanged.remove(existingTracker.handler);
        if (existingTracker.selectionHandler) ws.onSelectionChanged.remove(existingTracker.selectionHandler);
        await ctx.sync();
      });
    }

    // Setup change and selection handlers with tracker context
    await Excel.run(async (ctx) => {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      tracker.handler = ws.onChanged.add((event) => handleWorksheetChange(event, tracker));
      tracker.selectionHandler = ws.onSelectionChanged.add((event) => handleSelectionChange(event, tracker));
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

          // Skip if already processing
          const state = cellState.get(cellKey);
          if (state?.status === 'processing') continue;

          // Check if value changed
          if (state?.value !== cleanValue) {
            cellState.set(cellKey, {
              value: cleanValue,
              status: 'processing',
              row,
              col,
              targetCol
            });
            ws.getRangeByIndexes(row, col, 1, 1).format.fill.color = PROCESSING_COLORS.PENDING;
            // Each processCell creates its own Excel context for immediate updates
            tasks.push(() => processCell(row, col, targetCol, cleanValue, tracker, cellKey));
          }
        }
      }
    }
    await ctx.sync();

    // Execute all processing tasks
    for (const task of tasks) await task();
  });
};

// Handle cell selection to show match details in history tab
const handleSelectionChange = async (e, tracker) => {
  if (!tracker.active) return;

  await Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const range = ws.getRange(e.address);
    range.load("rowIndex, columnIndex, rowCount, columnCount");
    await ctx.sync();

    // Only handle single cell selections
    // eslint-disable-next-line office-addins/call-sync-before-read
    if (range.rowCount !== 1 || range.columnCount !== 1) return;

    // eslint-disable-next-line office-addins/call-sync-before-read
    const row = range.rowIndex;
    // eslint-disable-next-line office-addins/call-sync-before-read
    const col = range.columnIndex;

    // Check if this is an output cell we have data for
    const cellKey = createCellKey(row, col);
    const state = cellState.get(cellKey);

    if (state && state.status === 'complete') {
      // Dynamically import to avoid circular dependency
      const { handleCellSelection } = await import("../ui-components/ActivityFeedUI.js");
      handleCellSelection(cellKey, state);
    }
  });
};

// Creates independent Excel.run context - do not pass worksheet objects or updates will batch
async function processCell(row, col, targetCol, value, tracker, cellKey) {
  // Create output cell key upfront (activities track output column, not input)
  const outputCellKey = createCellKey(row, targetCol);

  try {
    // Always returns valid result (never null)
    const result = await processTermNormalization(
      value,
      tracker.mappings.forward,
      tracker.mappings.reverse
    );

    if (result.candidates) {
      addCandidate(value, result, {
        applyChoice: (choice) => applyChoiceToCell(row, col, targetCol, value, choice, outputCellKey),
      });
    }

    await Excel.run(async (ctx) => {
      ctx.runtime.enableEvents = false;

      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
      const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

      tgtCell.values = [[result.target]];
      tgtCell.format.fill.color = getRelevanceColor(result.confidence);
      srcCell.format.fill.clear();

      await ctx.sync();
      ctx.runtime.enableEvents = true;
    });

    // Store result in unified cell state (using OUTPUT cell key)
    cellState.set(outputCellKey, {
      value,
      result,
      status: 'complete',
      row,
      col: targetCol,  // Output column, not input
      timestamp: result.timestamp
    });

    // Add activity with output cell key (so selection works)
    addActivity(value, outputCellKey, result.timestamp);
    // Note: Automatic logging removed - training records now captured in backend
    // User manual selections still logged via handleCandidateChoice()
  } catch (error) {
    await handleCellError(row, col, targetCol, value, error, outputCellKey);
    // Note: handleCellError stores error in cellState
  }
}

async function handleCellError(row, col, targetCol, value, error, outputCellKey) {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const timestamp = new Date().toISOString();

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

  // Store error in cellState
  cellState.set(outputCellKey, {
    value,
    result: {
      target: errorMsg,
      method: "error",
      confidence: 0,
      timestamp
    },
    status: 'error',
    row,
    col: targetCol,
    timestamp
  });

  addActivity(value, outputCellKey, timestamp);
}

async function applyChoiceToCell(row, col, targetCol, value, choice, outputCellKey) {
  const timestamp = new Date().toISOString();

  await Excel.run(async (ctx) => {
    ctx.runtime.enableEvents = false;

    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
    const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

    tgtCell.values = [[choice.candidate]];
    tgtCell.format.fill.color = getRelevanceColor(choice.relevance_score);
    srcCell.format.fill.clear();

    await ctx.sync();
    ctx.runtime.enableEvents = true;
  });

  // Store user choice in cellState
  cellState.set(outputCellKey, {
    value,
    result: {
      target: choice.candidate,
      method: "UserChoice",
      confidence: choice.relevance_score,
      timestamp
    },
    status: 'complete',
    row,
    col: targetCol,
    timestamp
  });

  addActivity(value, outputCellKey, timestamp);
}

export async function stopTracking(workbookId) {
  if (!workbookId) {
    workbookId = await getCurrentWorkbookName();
  }

  const tracker = activeTrackers.get(workbookId);
  if (tracker) {
    tracker.active = false;

    if (tracker.handler || tracker.selectionHandler) {
      await Excel.run(async (ctx) => {
        const ws = ctx.workbook.worksheets.getActiveWorksheet();
        if (tracker.handler) ws.onChanged.remove(tracker.handler);
        if (tracker.selectionHandler) ws.onSelectionChanged.remove(tracker.selectionHandler);
        await ctx.sync();
      });
    }

    activeTrackers.delete(workbookId);
    cellState.clear();
    console.log(`✓ Tracking stopped for workbook: ${workbookId}`);
  }
}

export function getActiveTrackers() {
  return Array.from(activeTrackers.keys());
}

// Export cell state accessor for other modules
export function getCellState(cellKey) {
  return cellState.get(cellKey);
}

export function getCellStateByCoords(row, col) {
  const cellKey = createCellKey(row, col);
  return cellState.get(cellKey);
}
