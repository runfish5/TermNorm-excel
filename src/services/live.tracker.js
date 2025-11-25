import { add as addActivity } from "../ui-components/ActivityFeedUI.js";
import { addCandidate } from "../ui-components/CandidateRankingUI.js";
import { processTermNormalization } from "./normalizer.functions.js";
import { buildColumnMap, buildConfidenceColumnMap } from "../utils/column-utilities.js";
import { createCellKey, hasValueChanged, cleanCellValue } from "../utils/cell-utilities.js";
import { getRelevanceColor, PROCESSING_COLORS, getCurrentWorkbookName } from "../utils/app-utilities.js";
const activeTrackers = new Map();
const activationInProgress = new Set();
// Unified cell state scoped per workbook: workbookId → Map(cellKey → {value, result, status, row, col, targetCol, timestamp})
const cellStateByWorkbook = new Map();

/**
 * Get or create cellState Map for a specific workbook
 * @param {string} workbookId - Workbook identifier
 * @returns {Map} Cell state map for the workbook
 */
function getCellStateMap(workbookId) {
  if (!cellStateByWorkbook.has(workbookId)) {
    cellStateByWorkbook.set(workbookId, new Map());
  }
  return cellStateByWorkbook.get(workbookId);
}

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
    // Clear cell state for THIS workbook only
    getCellStateMap(workbookId).clear();
    const { columnMap, confidenceColumnMap, confidenceFound, confidenceMissing } = await Excel.run(async (ctx) => {
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
      const confResult = buildConfidenceColumnMap(headerNames, config.confidence_column_map, worksheetName);

      return {
        columnMap: buildColumnMap(headerNames, config.column_map, worksheetName),
        confidenceColumnMap: confResult.map,
        confidenceFound: confResult.found,
        confidenceMissing: confResult.missing,
      };
    });

    // Create tracker instance for this workbook
    const tracker = {
      active: true,
      handler: null,
      selectionHandler: null,
      columnMap,
      confidenceColumnMap,
      confidenceFound,
      confidenceMissing,
      mappings,
      config,
      workbookId,
    };

    // Remove existing tracker if any
    const existingTracker = activeTrackers.get(workbookId);
    if (existingTracker) {
      // Mark as inactive FIRST to prevent any queued/in-flight events from processing with old column indices
      existingTracker.active = false;

      if (existingTracker.handler || existingTracker.selectionHandler) {
        await Excel.run(async (ctx) => {
          const ws = ctx.workbook.worksheets.getActiveWorksheet();
          if (existingTracker.handler) ws.onChanged.remove(existingTracker.handler);
          if (existingTracker.selectionHandler) ws.onSelectionChanged.remove(existingTracker.selectionHandler);
          await ctx.sync();
        });
      }
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

    // Return tracking status info
    return {
      workbookId,
      columnCount: tracker.columnMap.size,
      confidenceTotal: Object.keys(config.confidence_column_map || {}).length,
      confidenceMapped: tracker.confidenceColumnMap.size,
      confidenceFound,
      confidenceMissing,
    };
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
          const cellStateMap = getCellStateMap(tracker.workbookId);
          const state = cellStateMap.get(cellKey);
          if (state?.status === "processing") continue;

          // Check if value changed
          if (state?.value !== cleanValue) {
            cellStateMap.set(cellKey, {
              value: cleanValue,
              status: "processing",
              row,
              col,
              targetCol,
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
    range.load("rowIndex, columnIndex, rowCount, columnCount, values");
    await ctx.sync();

    // Only handle single cell selections
    // eslint-disable-next-line office-addins/call-sync-before-read
    if (range.rowCount !== 1 || range.columnCount !== 1) return;

    // eslint-disable-next-line office-addins/call-sync-before-read
    const row = range.rowIndex;
    // eslint-disable-next-line office-addins/call-sync-before-read
    const col = range.columnIndex;
    // eslint-disable-next-line office-addins/call-sync-before-read
    const cellValue = range.values[0][0];

    // Skip empty cells and header row
    if (!cellValue || row === 0) return;

    const cellKey = createCellKey(row, col);
    const cleanedValue = String(cellValue).trim();

    // Dynamically import to avoid circular dependency
    const { handleCellSelection } = await import("../ui-components/ActivityFeedUI.js");

    // Check if this is an INPUT column (columnMap has inputCol → outputCol)
    const targetCol = tracker.columnMap.get(col);
    if (targetCol !== undefined) {
      // Input column: use forward mapping to get the target identifier
      let targetIdentifier = tracker.mappings.forward[cleanedValue];

      // Fallback: search history cache by source (for previously processed entries)
      if (!targetIdentifier) {
        const { findTargetBySource } = await import("../utils/history-cache.js");
        targetIdentifier = findTargetBySource(cleanedValue);
      }

      if (targetIdentifier) {
        handleCellSelection(null, null, targetIdentifier);
      }
      // If still no match, no entry exists for this source - do nothing
      return;
    }

    // Output column: check cellState first, then historical lookup
    const cellStateMap = getCellStateMap(tracker.workbookId);
    const state = cellStateMap.get(cellKey);
    if (state && state.status === "complete") {
      // Current session: use cellState
      handleCellSelection(cellKey, state, null);
    } else {
      // Historical: pass cell value as identifier to lookup from database
      handleCellSelection(null, null, cleanedValue);
    }
  });
};

// Creates independent Excel.run context - do not pass worksheet objects or updates will batch
async function processCell(row, col, targetCol, value, tracker, cellKey) {
  // Create output cell key upfront (activities track output column, not input)
  const outputCellKey = createCellKey(row, targetCol);

  try {
    // Always returns valid result (never null)
    const result = await processTermNormalization(value, tracker.mappings.forward, tracker.mappings.reverse);

    if (result.candidates) {
      addCandidate(value, result, {
        applyChoice: (choice) => applyChoiceToCell(row, col, targetCol, value, choice, outputCellKey, tracker),
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

      // Write confidence value if confidence column is configured
      const confidenceCol = tracker.confidenceColumnMap.get(col);
      if (confidenceCol !== undefined) {
        const confCell = ws.getRangeByIndexes(row, confidenceCol, 1, 1);
        // Convert confidence from 0.0-1.0 to 0-100 integer
        const confidencePercent = Math.round(result.confidence * 100);
        confCell.values = [[confidencePercent]];
      }

      await ctx.sync();
      ctx.runtime.enableEvents = true;
    });

    // Store result in unified cell state (using OUTPUT cell key)
    const cellStateMap = getCellStateMap(tracker.workbookId);
    cellStateMap.set(outputCellKey, {
      value,
      result,
      status: "complete",
      row,
      col: targetCol, // Output column, not input
      timestamp: result.timestamp,
    });

    // Add activity with output cell key (so selection works)
    addActivity(value, outputCellKey, result.timestamp, result);
    // Note: Automatic logging removed - training records now captured in backend
    // User manual selections still logged via handleCandidateChoice()
  } catch (error) {
    await handleCellError(row, col, targetCol, value, error, outputCellKey, tracker);
    // Note: handleCellError stores error in cellState
  }
}

async function handleCellError(row, col, targetCol, value, error, outputCellKey, tracker) {
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

    // Write 0 confidence for errors if confidence column is configured
    const confidenceCol = tracker.confidenceColumnMap.get(col);
    if (confidenceCol !== undefined) {
      const confCell = ws.getRangeByIndexes(row, confidenceCol, 1, 1);
      confCell.values = [[0]];
    }

    await ctx.sync();
    ctx.runtime.enableEvents = true;
  });

  // Build error result
  const errorResult = {
    target: errorMsg,
    method: "error",
    confidence: 0,
    timestamp,
    source: value,
    candidates: null,
    entity_profile: null,
    web_sources: null,
    total_time: null,
    llm_provider: null,
    web_search_status: "idle",
  };

  // Store error in cellState
  const cellStateMap = getCellStateMap(tracker.workbookId);
  cellStateMap.set(outputCellKey, {
    value,
    result: errorResult,
    status: "error",
    row,
    col: targetCol,
    timestamp,
  });

  addActivity(value, outputCellKey, timestamp, errorResult);
}

async function applyChoiceToCell(row, col, targetCol, value, choice, outputCellKey, tracker) {
  const timestamp = new Date().toISOString();

  await Excel.run(async (ctx) => {
    ctx.runtime.enableEvents = false;
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
    const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

    tgtCell.values = [[choice.candidate]];
    tgtCell.format.fill.color = getRelevanceColor(choice.relevance_score);
    srcCell.format.fill.clear();

    // Write confidence value if confidence column is configured
    const confidenceCol = tracker.confidenceColumnMap.get(col);
    if (confidenceCol !== undefined) {
      const confCell = ws.getRangeByIndexes(row, confidenceCol, 1, 1);
      const confidencePercent = Math.round(choice.relevance_score * 100);
      confCell.values = [[confidencePercent]];
    }

    await ctx.sync();
    ctx.runtime.enableEvents = true;
  });

  const choiceResult = {
    target: choice.candidate,
    method: "UserChoice",
    confidence: choice.relevance_score,
    timestamp,
    source: value,
    candidates: null,
    entity_profile: choice.entity_profile || null,
    web_sources: choice.web_sources || null,
    total_time: null,
    llm_provider: null,
    web_search_status: "idle",
  };

  const cellStateMap = getCellStateMap(tracker.workbookId);
  cellStateMap.set(outputCellKey, {
    value,
    result: choiceResult,
    status: "complete",
    row,
    col: targetCol,
    timestamp,
  });

  addActivity(value, outputCellKey, timestamp, choiceResult);

  // Log user choice to backend
  try {
    const { apiPost } = await import("../utils/api-fetch.js");
    const { getHost, getHeaders } = await import("../utils/server-utilities.js");
    await apiPost(
      `${getHost()}/log-activity`,
      {
        source: value,
        target: choice.candidate,
        method: "UserChoice",
        confidence: choice.relevance_score,
        timestamp,
      },
      getHeaders()
    );
  } catch (error) {
    console.warn("Failed to log user choice to backend:", error);
  }
}

export async function stopTracking(workbookId) {
  if (!workbookId) workbookId = await getCurrentWorkbookName();

  const tracker = activeTrackers.get(workbookId);
  if (!tracker) return;

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
  cellStateByWorkbook.delete(workbookId);
  console.log(`✓ Tracking stopped for workbook: ${workbookId}`);
}

export function getActiveTrackers() {
  return Array.from(activeTrackers.keys());
}

// Export cell state accessors - searches all workbooks
export function getCellState(cellKey) {
  for (const cellStateMap of cellStateByWorkbook.values()) {
    const state = cellStateMap.get(cellKey);
    if (state) return state;
  }
  return undefined;
}

export function getCellStateByCoords(row, col) {
  const cellKey = createCellKey(row, col);
  return getCellState(cellKey);
}
