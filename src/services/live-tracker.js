import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { setCellState, getWorkbookCellState, clearWorkbookCells, deleteWorkbook } from "../core/state-actions.js";
import { processTermNormalization } from "./normalizer.js";
import { buildColumnMap, buildConfidenceColumnMap } from "../utils/column-utilities.js";
import { getCurrentWorkbookName, getRelevanceColor } from "../utils/app-utilities.js";
import { PROCESSING_COLORS, ENDPOINTS, createMatchResult, USER_ACTION_CONFIDENCE } from "../config/config.js";
import { showMessage } from "../utils/ui-feedback.js";
import { findTargetBySource } from "../utils/history-cache.js";
import { apiPost, getHeaders, buildUrl, fireAndForget } from "../utils/api-fetch.js";

const activeTrackers = new Map();
const activationInProgress = new Set();

const removeHandlers = async (tracker) => {
  if (!tracker) return;
  tracker.active = false;
  await Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    if (tracker.handler) ws.onChanged.remove(tracker.handler);
    if (tracker.selectionHandler) ws.onSelectionChanged.remove(tracker.selectionHandler);
    await ctx.sync();
  });
};

export async function startTracking(config, mappings) {
  if (!config?.column_map || !mappings) throw new Error("Config and mappings required");
  const workbookId = await getCurrentWorkbookName();
  if (activationInProgress.has(workbookId)) return;
  activationInProgress.add(workbookId);

  try {
    clearWorkbookCells(workbookId);

    const { columnMap, confidenceColumnMap, confidenceFound, confidenceMissing } = await Excel.run(async (ctx) => {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      ws.load("name");
      const usedRange = ws.getUsedRange(true);
      usedRange.load("columnIndex, columnCount");
      await ctx.sync();

      const headers = ws.getRangeByIndexes(0, 0, 1, usedRange.columnIndex + usedRange.columnCount);
      headers.load("values");
      await ctx.sync();

      const headerNames = headers.values[0].map(h => String(h || "").trim());
      const confResult = buildConfidenceColumnMap(headerNames, config.column_map, ws.name);
      return { columnMap: buildColumnMap(headerNames, config.column_map, ws.name), ...confResult };
    });

    await removeHandlers(activeTrackers.get(workbookId));

    const tracker = { active: true, handler: null, selectionHandler: null, columnMap, confidenceColumnMap: confidenceColumnMap || new Map(), confidenceFound, confidenceMissing, mappings, config, workbookId };

    await Excel.run(async (ctx) => {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      tracker.handler = ws.onChanged.add(e => handleWorksheetChange(e, tracker));
      tracker.selectionHandler = ws.onSelectionChanged.add(e => handleSelectionChange(e, tracker));
      await ctx.sync();
    });

    activeTrackers.set(workbookId, tracker);
    return { workbookId, columnCount: tracker.columnMap.size, confidenceTotal: Object.values(config.column_map || {}).filter(m => m.confidence).length, confidenceMapped: tracker.confidenceColumnMap.size, confidenceFound, confidenceMissing };
  } finally { activationInProgress.delete(workbookId); }
}

const handleWorksheetChange = async (e, tracker) => {
  if (!tracker.active) return;
  await Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet(), range = ws.getRange(e.address);
    range.load("values, rowIndex, columnIndex, rowCount, columnCount");
    await ctx.sync();

    const { rowCount, columnCount, rowIndex, columnIndex, values } = range;
    const cells = Array.from({ length: rowCount }, (_, r) => Array.from({ length: columnCount }, (_, c) => {
      const row = rowIndex + r, col = columnIndex + c, targetCol = tracker.columnMap.get(col);
      return row > 0 && targetCol !== undefined ? { row, col, targetCol, value: values[r][c] } : null;
    })).flat().filter(Boolean);

    // Check for output column edits (DirectEdit - user typed directly in result column)
    const outputEdits = Array.from({ length: rowCount }, (_, r) => Array.from({ length: columnCount }, (_, c) => {
      const row = rowIndex + r, col = columnIndex + c, newValue = values[r][c];
      if (row === 0 || !newValue) return null;
      for (const [inputCol, outputCol] of tracker.columnMap) {
        if (outputCol === col) return { row, inputCol, newValue };
      }
      return null;
    })).flat().filter(Boolean);

    // Log DirectEdits (fire-and-forget, don't block normal processing)
    for (const { row, inputCol, newValue } of outputEdits) {
      const cellKey = `${row}:${inputCol}`;
      const cellState = getWorkbookCellState(tracker.workbookId, cellKey);

      // Prefer stored value (guaranteed to match), fallback to Excel read
      let sourceValue = cellState?.value;
      if (!sourceValue) {
        const inputRange = ws.getRangeByIndexes(row, inputCol, 1, 1);
        inputRange.load("values");
        await ctx.sync();
        sourceValue = inputRange.values[0][0];
      }

      if (sourceValue) {
        const timestamp = new Date().toISOString();
        const source = String(sourceValue).trim();
        const target = String(newValue).trim();
        const result = { target, method: "DirectEdit", confidence: USER_ACTION_CONFIDENCE, timestamp, source };

        // Emit event for history table
        eventBus.emit(Events.MATCH_LOGGED, { value: source, cellKey, timestamp, result });

        // Also log to API (fire-and-forget)
        fireAndForget(apiPost(buildUrl(ENDPOINTS.ACTIVITIES), { source, target, method: "DirectEdit", confidence: USER_ACTION_CONFIDENCE, timestamp }, getHeaders()));

        // Update confidence column
        const confCol = tracker.confidenceColumnMap.get(inputCol);
        if (confCol !== undefined) ws.getRangeByIndexes(row, confCol, 1, 1).values = [[100]];
      }
    }

    const withValue = cells.filter(c => c.value);
    if (withValue.length >= 2) {
      // Don't color cells - just warn and exit (avoids leaving cells yellow permanently)
      return showMessage(`Paste detected (${cells.length} cells). Edit individually.`, "warning");
    }

    const tasks = withValue.map(({ row, col, targetCol, value }) => {
      const cellKey = `${row}:${col}`, cleanValue = String(value).trim(), state = getWorkbookCellState(tracker.workbookId, cellKey);
      if (state?.status === "processing" || state?.value === cleanValue) return null;
      setCellState(tracker.workbookId, cellKey, { value: cleanValue, status: "processing", row, col, targetCol });
      ws.getRangeByIndexes(row, col, 1, 1).format.fill.color = PROCESSING_COLORS.PENDING;
      return () => processCell(row, col, targetCol, cleanValue, tracker);
    }).filter(Boolean);

    await ctx.sync();
    for (const task of tasks) await task();
  });
};

const handleSelectionChange = async (e, tracker) => {
  if (!tracker.active) return;
  await Excel.run(async (ctx) => {
    const range = ctx.workbook.worksheets.getActiveWorksheet().getRange(e.address);
    range.load("rowIndex, columnIndex, rowCount, columnCount, values");
    await ctx.sync();

    if (range.rowCount !== 1 || range.columnCount !== 1 || !range.values[0][0] || range.rowIndex === 0) return;
    const row = range.rowIndex, col = range.columnIndex, cellKey = `${row}:${col}`, value = String(range.values[0][0]).trim();

    if (tracker.columnMap.has(col)) {
      const id = tracker.mappings.forward[value] || findTargetBySource(value);
      // Pass source value for reliable row lookup (table is keyed by source, not identifier)
      eventBus.emit(Events.CELL_SELECTED, { cellKey: null, state: null, identifier: id, source: value });
    } else {
      const state = getWorkbookCellState(tracker.workbookId, cellKey);
      eventBus.emit(Events.CELL_SELECTED, state?.status === "complete" ? { cellKey, state, identifier: null } : { cellKey: null, state: null, identifier: value });
    }
  });
};

function logResult(workbookId, cellKey, value, result, status, row, col) {
  setCellState(workbookId, cellKey, { value, result, status, row, col, timestamp: result.timestamp });
  eventBus.emit(Events.MATCH_LOGGED, { value, cellKey, timestamp: result.timestamp, result });
}

// Cell writing (inlined from cell-writing.js)
async function writeCellResult(row, inputCol, outputCol, targetValue, confidence, confidenceColumnMap) {
  await Excel.run(async (ctx) => {
    ctx.runtime.enableEvents = false;
    try {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      ws.getRangeByIndexes(row, outputCol, 1, 1).values = [[targetValue]];
      ws.getRangeByIndexes(row, outputCol, 1, 1).format.fill.color = getRelevanceColor(confidence);
      ws.getRangeByIndexes(row, inputCol, 1, 1).format.fill.clear();
      const confCol = confidenceColumnMap.get(inputCol);
      if (confCol !== undefined) ws.getRangeByIndexes(row, confCol, 1, 1).values = [[Math.round(confidence * 100)]];
      await ctx.sync();
    } finally {
      ctx.runtime.enableEvents = true;
    }
  });
}

async function processCell(row, col, targetCol, value, tracker) {
  const outputCellKey = `${row}:${targetCol}`;
  try {
    const result = await processTermNormalization(value, tracker.mappings.forward, tracker.mappings.reverse);
    if (result.candidates) eventBus.emit(Events.CANDIDATES_AVAILABLE, { source: value, result, applyChoice: choice => applyChoiceToCell(row, col, targetCol, value, choice, outputCellKey, tracker) });
    await writeCellResult(row, col, targetCol, result.target, result.confidence, tracker.confidenceColumnMap);
    logResult(tracker.workbookId, outputCellKey, value, result, "complete", row, targetCol);
  } catch (error) {
    await handleCellError(row, col, targetCol, value, error, outputCellKey, tracker);
  }
}

async function handleCellError(row, col, targetCol, value, error, outputCellKey, tracker) {
  const msg = error?.message || String(error);
  await Excel.run(async (ctx) => {
    ctx.runtime.enableEvents = false;
    try {
      const ws = ctx.workbook.worksheets.getActiveWorksheet(), cell = (r, c) => ws.getRangeByIndexes(r, c, 1, 1);
      cell(row, col).format.fill.color = PROCESSING_COLORS.ERROR;
      cell(row, targetCol).values = [[msg]];
      cell(row, targetCol).format.fill.color = PROCESSING_COLORS.ERROR;
      const confCol = tracker.confidenceColumnMap.get(col);
      if (confCol !== undefined) cell(row, confCol).values = [[0]];
      await ctx.sync();
    } finally {
      ctx.runtime.enableEvents = true;
    }
  });
  logResult(tracker.workbookId, outputCellKey, value, createMatchResult({ target: msg, method: "error", confidence: 0, source: value }), "error", row, targetCol);
}

async function applyChoiceToCell(row, col, targetCol, value, choice, outputCellKey, tracker) {
  const result = createMatchResult({ target: choice.candidate, method: "UserChoice", confidence: USER_ACTION_CONFIDENCE, source: value, entity_profile: choice.entity_profile || null, web_sources: choice.web_sources || null });
  await writeCellResult(row, col, targetCol, choice.candidate, USER_ACTION_CONFIDENCE, tracker.confidenceColumnMap);
  logResult(tracker.workbookId, outputCellKey, value, result, "complete", row, targetCol);
  fireAndForget(apiPost(buildUrl(ENDPOINTS.ACTIVITIES), { source: value, target: choice.candidate, method: "UserChoice", confidence: USER_ACTION_CONFIDENCE, timestamp: result.timestamp }, getHeaders()));
}

export async function stopTracking(workbookId) {
  workbookId = workbookId || (await getCurrentWorkbookName());
  const tracker = activeTrackers.get(workbookId);
  if (!tracker) return;
  await removeHandlers(tracker);
  activeTrackers.delete(workbookId);
  deleteWorkbook(workbookId);
}

export function getActiveTrackers() { return Array.from(activeTrackers.keys()); }
