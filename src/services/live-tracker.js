import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { setCellState, getWorkbookCellState, clearWorkbookCells, deleteWorkbook } from "../core/state-actions.js";
import { processTermNormalization } from "./normalizer.functions.js";
import { buildColumnMap, buildConfidenceColumnMap } from "../utils/column-utilities.js";
import { PROCESSING_COLORS, getCurrentWorkbookName } from "../utils/app-utilities.js";
import { writeCellResult } from "../utils/cell-writing.js";
import { addEntry as addHistoryEntry } from "../ui-components/processing-history.js";
import { showMessage } from "../utils/error-display.js";

const activeTrackers = new Map();
const activationInProgress = new Set();

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

      const lastCol = usedRange.columnIndex + usedRange.columnCount - 1;
      const headers = ws.getRangeByIndexes(0, 0, 1, lastCol + 1);
      headers.load("values");
      await ctx.sync();

      const headerNames = headers.values[0].map((h) => String(h || "").trim());
      const confResult = buildConfidenceColumnMap(headerNames, config.confidence_column_map, ws.name);

      return { columnMap: buildColumnMap(headerNames, config.column_map, ws.name), confidenceColumnMap: confResult.map, confidenceFound: confResult.found, confidenceMissing: confResult.missing };
    });

    const tracker = { active: true, handler: null, selectionHandler: null, columnMap, confidenceColumnMap, confidenceFound, confidenceMissing, mappings, config, workbookId };

    const existing = activeTrackers.get(workbookId);
    if (existing?.active) {
      existing.active = false;
      await Excel.run(async (ctx) => {
        const ws = ctx.workbook.worksheets.getActiveWorksheet();
        if (existing.handler) ws.onChanged.remove(existing.handler);
        if (existing.selectionHandler) ws.onSelectionChanged.remove(existing.selectionHandler);
        await ctx.sync();
      });
    }

    await Excel.run(async (ctx) => {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      tracker.handler = ws.onChanged.add((e) => handleWorksheetChange(e, tracker));
      tracker.selectionHandler = ws.onSelectionChanged.add((e) => handleSelectionChange(e, tracker));
      await ctx.sync();
    });

    activeTrackers.set(workbookId, tracker);

    const trackingInfo = { workbookId, columnCount: tracker.columnMap.size, confidenceTotal: Object.keys(config.confidence_column_map || {}).length, confidenceMapped: tracker.confidenceColumnMap.size, confidenceFound, confidenceMissing };
    eventBus.emit(Events.TRACKING_STARTED, trackingInfo);
    return trackingInfo;
  } finally { activationInProgress.delete(workbookId); }
}

const handleWorksheetChange = async (e, tracker) => {
  if (!tracker.active) return;

  await Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const range = ws.getRange(e.address);
    range.load("values, rowIndex, columnIndex, rowCount, columnCount");
    await ctx.sync();

    const { rowCount, columnCount, rowIndex, columnIndex, values } = range;
    const cells = [];
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < columnCount; c++) {
        const row = rowIndex + r, col = columnIndex + c, targetCol = tracker.columnMap.get(col);
        if (row > 0 && targetCol !== undefined) cells.push({ row, col, targetCol, value: values[r][c] });
      }
    }

    if (cells.filter(c => c.value).length >= 2) {
      cells.filter(c => c.value).forEach(c => ws.getRangeByIndexes(c.row, c.col, 1, 1).format.fill.color = PROCESSING_COLORS.PENDING);
      await ctx.sync();
      return showMessage(`Paste detected (${cells.length} cells). Edit individually to process.`, "warning");
    }

    const tasks = cells.filter(c => c.value).map(({ row, col, targetCol, value }) => {
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
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const range = ws.getRange(e.address);
    range.load("rowIndex, columnIndex, rowCount, columnCount, values");
    await ctx.sync();

    if (range.rowCount !== 1 || range.columnCount !== 1) return;

    const row = range.rowIndex, col = range.columnIndex, cellValue = range.values[0][0];
    if (!cellValue || row === 0) return;

    const cellKey = `${row}:${col}`;
    const cleanedValue = String(cellValue).trim();

    const targetCol = tracker.columnMap.get(col);
    if (targetCol !== undefined) {
      let targetId = tracker.mappings.forward[cleanedValue];
      if (!targetId) {
        const { findTargetBySource } = await import("../utils/history-cache.js");
        targetId = findTargetBySource(cleanedValue);
      }
      if (targetId) eventBus.emit(Events.CELL_SELECTED, { cellKey: null, state: null, identifier: targetId });
      return;
    }

    const state = getWorkbookCellState(tracker.workbookId, cellKey);
    eventBus.emit(Events.CELL_SELECTED, state?.status === "complete" ? { cellKey, state, identifier: null } : { cellKey: null, state: null, identifier: cleanedValue });
  });
};

function logResult(workbookId, cellKey, value, result, status, row, col) {
  setCellState(workbookId, cellKey, { value, result, status, row, col, timestamp: result.timestamp });
  addHistoryEntry(value, cellKey, result.timestamp, result);
}

async function processCell(row, col, targetCol, value, tracker) {
  const outputCellKey = `${row}:${targetCol}`;
  eventBus.emit(Events.CELL_PROCESSING_STARTED, { cellKey: `${row}:${col}`, value, row, col, targetCol });

  try {
    const result = await processTermNormalization(value, tracker.mappings.forward, tracker.mappings.reverse);

    if (result.candidates) {
      eventBus.emit(Events.CANDIDATES_AVAILABLE, { source: value, result, applyChoice: (choice) => applyChoiceToCell(row, col, targetCol, value, choice, outputCellKey, tracker) });
    }

    await writeCellResult(row, col, targetCol, result.target, result.confidence, tracker.confidenceColumnMap);
    logResult(tracker.workbookId, outputCellKey, value, result, "complete", row, targetCol);
    eventBus.emit(Events.CELL_PROCESSING_COMPLETE, { cellKey: `${row}:${col}`, source: value, result, row, col, targetCol });
  } catch (error) {
    eventBus.emit(Events.CELL_PROCESSING_ERROR, { cellKey: `${row}:${col}`, value, error: error.message || String(error), row, col, targetCol });
    await handleCellError(row, col, targetCol, value, error, outputCellKey, tracker);
  }
}

const makeResult = (target, method, confidence, source, extras = {}) => ({ target, method, confidence, timestamp: new Date().toISOString(), source, candidates: null, entity_profile: null, web_sources: null, total_time: null, llm_provider: null, web_search_status: "idle", ...extras });

async function handleCellError(row, col, targetCol, value, error, outputCellKey, tracker) {
  const msg = error?.message || String(error);
  await Excel.run(async (ctx) => {
    ctx.runtime.enableEvents = false;
    const ws = ctx.workbook.worksheets.getActiveWorksheet(), cell = (r, c) => ws.getRangeByIndexes(r, c, 1, 1);
    cell(row, col).format.fill.color = PROCESSING_COLORS.ERROR;
    cell(row, targetCol).values = [[msg]];
    cell(row, targetCol).format.fill.color = PROCESSING_COLORS.ERROR;
    const confCol = tracker.confidenceColumnMap.get(col);
    if (confCol !== undefined) cell(row, confCol).values = [[0]];
    await ctx.sync();
    ctx.runtime.enableEvents = true;
  });
  logResult(tracker.workbookId, outputCellKey, value, makeResult(msg, "error", 0, value), "error", row, targetCol);
}

async function applyChoiceToCell(row, col, targetCol, value, choice, outputCellKey, tracker) {
  const result = makeResult(choice.candidate, "UserChoice", choice.relevance_score, value, { entity_profile: choice.entity_profile || null, web_sources: choice.web_sources || null });
  await writeCellResult(row, col, targetCol, choice.candidate, choice.relevance_score, tracker.confidenceColumnMap);
  logResult(tracker.workbookId, outputCellKey, value, result, "complete", row, targetCol);
  try {
    const [{ apiPost }, { getHost, getHeaders }] = await Promise.all([import("../utils/api-fetch.js"), import("../utils/server-utilities.js")]);
    await apiPost(`${getHost()}/log-activity`, { source: value, target: choice.candidate, method: "UserChoice", confidence: choice.relevance_score, timestamp: result.timestamp }, getHeaders());
  } catch {}
}

export async function stopTracking(workbookId) {
  workbookId = workbookId || (await getCurrentWorkbookName());
  const tracker = activeTrackers.get(workbookId);
  if (!tracker) return;

  tracker.active = false;
  await Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    if (tracker.handler) ws.onChanged.remove(tracker.handler);
    if (tracker.selectionHandler) ws.onSelectionChanged.remove(tracker.selectionHandler);
    await ctx.sync();
  });

  activeTrackers.delete(workbookId);
  deleteWorkbook(workbookId);
  eventBus.emit(Events.TRACKING_STOPPED, { workbookId });
}

export function getActiveTrackers() { return Array.from(activeTrackers.keys()); }
