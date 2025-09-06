// ./services/live.tracker.js
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";
import { ActivityDisplay } from "../ui-components/CandidateRankingUI.js";
import { NormalizerRouter } from "./normalizer.router.js";
import { getHost, getHeaders } from "../utils/serverConfig.js";
// Inlined column utilities
function findColumnIndex(headers, columnName) {
  if (!columnName || !headers) return -1;
  return headers.findIndex((h) => h?.toString().trim().toLowerCase() === columnName.toLowerCase());
}

function buildColumnMap(headers, columnMap) {
  const result = new Map();
  const missing = [];

  Object.entries(columnMap).forEach(([src, tgt]) => {
    const srcIdx = findColumnIndex(headers, src);
    const tgtIdx = findColumnIndex(headers, tgt);

    if (srcIdx === -1) missing.push(src);
    else if (tgtIdx === -1) missing.push(tgt);
    else result.set(srcIdx, tgtIdx);
  });

  if (missing.length > 0) {
    throw new Error(`Missing columns: ${missing.join(", ")}`);
  }

  return result;
}

// Inlined cell utilities
function createCellKey(row, col) {
  return `${row}:${col}`;
}

function hasValueChanged(cellValues, cellKey, newValue) {
  const oldValue = cellValues.get(cellKey);
  return oldValue !== newValue;
}

function cleanCellValue(value) {
  return String(value || "").trim();
}
// Inlined color utilities
function getRelevanceColor(score) {
  const s = score > 1 ? score / 100 : score;
  if (s >= 0.9) return "#C6EFCE"; // High confidence - light green
  if (s >= 0.8) return "#FFEB9C"; // Good - light yellow
  if (s >= 0.6) return "#FFD1A9"; // Medium - light orange
  if (s >= 0.2) return "#FFC7CE"; // Low - light red
  return "#E1E1E1"; // No confidence - light gray
}

const PROCESSING_COLORS = {
  PENDING: "#FFFB9D", // Light yellow for pending
  ERROR: "#FFC7CE", // Light red for errors
  CLEAR: null, // Clear formatting
};

// Inlined activity logging (from activity.logger.js)
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

export class LiveTracker {
  constructor() {
    this.active = false;
    this.handler = null;
    this.processor = null;
    this.columnMap = new Map();
    this.cellValues = new Map(); // Track cell values to detect actual changes
  }

  async start(config, mappings) {
    if (!config?.column_map || !mappings) throw new Error("Config and mappings required");

    this.columnMap = await this.buildColumnMap(config.column_map);
    this.processor = new NormalizerRouter(mappings.forward, mappings.reverse, config);

    await Excel.run(async (ctx) => {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      if (this.handler) ws.onChanged.remove(this.handler);
      this.handler = ws.onChanged.add(this.handleChange.bind(this));
      await ctx.sync();
    });

    this.active = true;
  }

  async buildColumnMap(colMap) {
    return await Excel.run(async (ctx) => {
      const headers = ctx.workbook.worksheets.getActiveWorksheet().getUsedRange(true).getRow(0);
      headers.load("values");
      await ctx.sync();

      const headerNames = headers.values[0].map((h) => String(h || "").trim());
      return buildColumnMap(headerNames, colMap);
    });
  }

  handleChange = async (e) => {
    if (!this.active) return;

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
          const targetCol = this.columnMap.get(col);
          const value = values[r][c];

          if (row > 0 && targetCol && value) {
            const cellKey = createCellKey(row, col);
            const cleanValue = cleanCellValue(value);

            // Only process if value actually changed
            if (hasValueChanged(this.cellValues, cellKey, cleanValue)) {
              this.cellValues.set(cellKey, cleanValue);
              // Mark cell as pending (inlined markCellPending)
              ws.getRangeByIndexes(row, col, 1, 1).format.fill.color = PROCESSING_COLORS.PENDING;
              tasks.push(() => this.processCell(ws, row, col, targetCol, cleanValue));
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

  async processCell(ws, row, col, targetCol, value) {
    try {
      const result = await this.processor.process(value);
      console.log(`Result: ${JSON.stringify(result, null, 2)}`);

      if (result?.candidates) {
        ActivityDisplay.addCandidate(value, result, {
          applyChoice: (choice) => this.applyChoice(ws, row, col, targetCol, value, choice),
        });
      }

      // Create and apply cell updates (inlined)
      const target = result?.target || "No matches found";
      const confidence = result?.confidence || 0;
      const method = result?.method || (result ? "match" : "no_match");

      // Apply to Excel directly
      const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
      const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

      tgtCell.values = [[target]];
      tgtCell.format.fill.color = getRelevanceColor(confidence);
      srcCell.format.fill.clear(); // Clear source formatting

      const updates = {
        value,
        target,
        method,
        confidence,
        metadata: {
          candidates: result?.candidates,
          total_time: result?.total_time || 0,
          llm_provider: result?.llm_provider,
        },
      };

      // Log activity
      ActivityFeed.add(updates.value, updates.target, updates.method, updates.confidence);
      logActivity(
        updates.value,
        updates.target,
        updates.method,
        updates.confidence,
        updates.metadata.total_time,
        updates.metadata.llm_provider
      );
    } catch (error) {
      this.handleCellError(ws, row, col, targetCol, value, error);
    }
  }

  async handleCellError(ws, row, col, targetCol, value, error) {
    // Handle error directly (inlined)
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Apply error to Excel directly
    const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
    const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

    srcCell.format.fill.color = PROCESSING_COLORS.ERROR;
    tgtCell.values = [[errorMsg]];
    tgtCell.format.fill.color = PROCESSING_COLORS.ERROR;

    // Log activity
    ActivityFeed.add(value, errorMsg, "error", 0);
    logActivity(value, errorMsg, "error", 0, 0, undefined);
  }

  applyChoice = async (ws, row, col, targetCol, value, choice) => {
    await Excel.run(async (ctx) => {
      // Apply choice directly (inlined)
      const srcCell = ctx.workbook.worksheets.getActiveWorksheet().getRangeByIndexes(row, col, 1, 1);
      const tgtCell = ctx.workbook.worksheets.getActiveWorksheet().getRangeByIndexes(row, targetCol, 1, 1);

      tgtCell.values = [[choice.candidate]];
      tgtCell.format.fill.color = getRelevanceColor(choice.relevance_score);
      srcCell.format.fill.clear(); // Clear source formatting

      // Log activity
      ActivityFeed.add(value, choice.candidate, "UserChoice", choice.relevance_score);
      logActivity(value, choice.candidate, "UserChoice", choice.relevance_score, 0, undefined);

      await ctx.sync();
    });
  };

  stop() {
    this.active = false;
  }
  static setup() {
    ActivityDisplay.init();
  }
}
