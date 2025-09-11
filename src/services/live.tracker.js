import { add as addActivity } from "../ui-components/ActivityFeedUI.js";
import { addCandidate } from "../ui-components/CandidateRankingUI.js";
import { processTermNormalization } from "./normalizer.functions.js";
import { columnMappingService } from "./column-mapping.service.js";
import { createCellKey, hasValueChanged, cleanCellValue } from "../utils/cell-utilities.js";
import { getRelevanceColor, PROCESSING_COLORS } from "../utils/app-utilities.js";
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

// Live tracking state
let trackingState = {
  active: false,
  handler: null,
  columnMap: new Map(),
  cellValues: new Map(),
  mappings: null,
  config: null,
};

export async function startTracking(config, mappings) {
  if (!config?.column_map || !mappings) throw new Error("Config and mappings required");

  // Use column mapping service for clean separation of concerns
  trackingState.columnMap = await columnMappingService.resolveColumnMapping(config);
  columnMappingService.validateMapping(trackingState.columnMap);

  trackingState.mappings = mappings;
  trackingState.config = config;

  await Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    if (trackingState.handler) ws.onChanged.remove(trackingState.handler);
    trackingState.handler = ws.onChanged.add(handleWorksheetChange);
    await ctx.sync();
  });

  trackingState.active = true;
}

const handleWorksheetChange = async (e) => {
  if (!trackingState.active) return;

  await Excel.run(async (ctx) => {
    const ws = ctx.workbook.worksheets.getActiveWorksheet();
    const range = ws.getRange(e.address);
    range.load("values, rowIndex, columnIndex, rowCount, columnCount");
    await ctx.sync();

    // Process all cells that need mapping
    const tasks = [];
    // eslint-disable-next-line office-addins/call-sync-after-load, office-addins/call-sync-before-read
    const rowCount = range.rowCount;
    // eslint-disable-next-line office-addins/call-sync-after-load, office-addins/call-sync-before-read
    const columnCount = range.columnCount;
    // eslint-disable-next-line office-addins/call-sync-after-load, office-addins/call-sync-before-read
    const rowIndex = range.rowIndex;
    // eslint-disable-next-line office-addins/call-sync-after-load, office-addins/call-sync-before-read
    const columnIndex = range.columnIndex;
    // eslint-disable-next-line office-addins/call-sync-after-load, office-addins/call-sync-before-read
    const values = range.values;

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < columnCount; c++) {
        const row = rowIndex + r;
        const col = columnIndex + c;
        const targetCol = trackingState.columnMap.get(col);
        const value = values[r][c];

        if (row > 0 && targetCol && value) {
          const cellKey = createCellKey(row, col);
          const cleanValue = cleanCellValue(value);

          // Only process if value actually changed
          if (hasValueChanged(trackingState.cellValues, cellKey, cleanValue)) {
            trackingState.cellValues.set(cellKey, cleanValue);
            // Mark cell as pending
            ws.getRangeByIndexes(row, col, 1, 1).format.fill.color = PROCESSING_COLORS.PENDING;
            tasks.push(() => processCell(ws, row, col, targetCol, cleanValue));
          }
        }
      }
    }

    // Execute all processing tasks
    for (const task of tasks) await task();
    await ctx.sync();
  });
};

async function processCell(ws, row, col, targetCol, value) {
  try {
    const result = await processTermNormalization(
      value,
      trackingState.mappings.forward,
      trackingState.mappings.reverse
    );

    if (result?.candidates) {
      addCandidate(value, result, {
        applyChoice: (choice) => applyChoiceToCell(ws, row, col, targetCol, value, choice),
      });
    }

    const target = result?.target || "No matches found";
    const confidence = result?.confidence || 0;
    const method = result?.method || (result ? "match" : "no_match");

    const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
    const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

    tgtCell.values = [[target]];
    tgtCell.format.fill.color = getRelevanceColor(confidence);
    srcCell.format.fill.clear();

    addActivity(value, target, method, confidence);
    logActivity(value, target, method, confidence, result?.total_time || 0, result?.llm_provider);
  } catch (error) {
    handleCellError(ws, row, col, targetCol, value, error);
  }
}

function handleCellError(ws, row, col, targetCol, value, error) {
  const errorMsg = error instanceof Error ? error.message : String(error);

  const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
  const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

  srcCell.format.fill.color = PROCESSING_COLORS.ERROR;
  tgtCell.values = [[errorMsg]];
  tgtCell.format.fill.color = PROCESSING_COLORS.ERROR;

  addActivity(value, errorMsg, "error", 0);
  logActivity(value, errorMsg, "error", 0, 0, undefined);
}

async function applyChoiceToCell(ws, row, col, targetCol, value, choice) {
  await Excel.run(async (ctx) => {
    const srcCell = ctx.workbook.worksheets.getActiveWorksheet().getRangeByIndexes(row, col, 1, 1);
    const tgtCell = ctx.workbook.worksheets.getActiveWorksheet().getRangeByIndexes(row, targetCol, 1, 1);

    tgtCell.values = [[choice.candidate]];
    tgtCell.format.fill.color = getRelevanceColor(choice.relevance_score);
    srcCell.format.fill.clear();

    addActivity(value, choice.candidate, "UserChoice", choice.relevance_score);
    logActivity(value, choice.candidate, "UserChoice", choice.relevance_score, 0, undefined);

    await ctx.sync();
  });
}

export function stopTracking() {
  trackingState.active = false;
}
