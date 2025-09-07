import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";
import { CandidateRankingUI } from "../ui-components/CandidateRankingUI.js";
import { processTermNormalization } from "./normalizer.functions.js";
import { buildColumnMap } from "../utils/column-utilities.js";
import { createCellKey, hasValueChanged, cleanCellValue } from "../utils/cell-utilities.js";
import { getRelevanceColor, PROCESSING_COLORS } from "../utils/color-utilities.js";
import { logActivity } from "../utils/activity-logger.js";

export class LiveTracker {
  constructor() {
    this.active = false;
    this.handler = null;
    this.columnMap = new Map();
    this.cellValues = new Map();
    this.mappings = null;
    this.config = null;
  }

  async start(config, mappings) {
    if (!config?.column_map || !mappings) throw new Error("Config and mappings required");

    this.columnMap = await this.buildColumnMap(config.column_map);
    this.mappings = mappings;
    this.config = config;

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
      const result = await processTermNormalization(value, this.mappings.forward, this.mappings.reverse, this.config);
      console.log(`Result: ${JSON.stringify(result, null, 2)}`);

      if (result?.candidates) {
        CandidateRankingUI.addCandidate(value, result, {
          applyChoice: (choice) => this.applyChoice(ws, row, col, targetCol, value, choice),
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

      ActivityFeed.add(value, target, method, confidence);
      logActivity(value, target, method, confidence, result?.total_time || 0, result?.llm_provider);
    } catch (error) {
      this.handleCellError(ws, row, col, targetCol, value, error);
    }
  }

  async handleCellError(ws, row, col, targetCol, value, error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
    const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

    srcCell.format.fill.color = PROCESSING_COLORS.ERROR;
    tgtCell.values = [[errorMsg]];
    tgtCell.format.fill.color = PROCESSING_COLORS.ERROR;

    ActivityFeed.add(value, errorMsg, "error", 0);
    logActivity(value, errorMsg, "error", 0, 0, undefined);
  }

  applyChoice = async (ws, row, col, targetCol, value, choice) => {
    await Excel.run(async (ctx) => {
      const srcCell = ctx.workbook.worksheets.getActiveWorksheet().getRangeByIndexes(row, col, 1, 1);
      const tgtCell = ctx.workbook.worksheets.getActiveWorksheet().getRangeByIndexes(row, targetCol, 1, 1);

      tgtCell.values = [[choice.candidate]];
      tgtCell.format.fill.color = getRelevanceColor(choice.relevance_score);
      srcCell.format.fill.clear();

      ActivityFeed.add(value, choice.candidate, "UserChoice", choice.relevance_score);
      logActivity(value, choice.candidate, "UserChoice", choice.relevance_score, 0, undefined);

      await ctx.sync();
    });
  };

  stop() {
    this.active = false;
  }
  static setup() {
    CandidateRankingUI.init();
  }
}
