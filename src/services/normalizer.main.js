// ./services/normalizer.main.js
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";
import { ActivityDisplay } from "../ui-components/CandidateRankingUI.js";
import { NormalizerRouter } from "./normalizer.router.js";
import { logActivity } from "../shared-services/activity.logger.js";

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

      const headerNames = headers.values[0].map((h) =>
        String(h || "")
          .trim()
          .toLowerCase()
      );
      const result = new Map();
      const missing = [];

      Object.entries(colMap).forEach(([src, tgt]) => {
        const srcIdx = headerNames.indexOf(src.toLowerCase());
        const tgtIdx = headerNames.indexOf(tgt.toLowerCase());

        if (srcIdx === -1) missing.push(src);
        else if (tgtIdx === -1) missing.push(tgt);
        else result.set(srcIdx, tgtIdx);
      });

      if (missing.length) throw new Error(`Missing columns: ${missing.join(", ")}`);
      return result;
    });
  }

  getRelevanceColor(score) {
    const s = score > 1 ? score / 100 : score;
    if (s >= 0.9) return "#C6EFCE";
    if (s >= 0.8) return "#FFEB9C";
    if (s >= 0.6) return "#FFD1A9";
    if (s >= 0.2) return "#FFC7CE";
    return "#E1E1E1";
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
      for (let r = 0; r < range.rowCount; r++) {
        for (let c = 0; c < range.columnCount; c++) {
          const row = range.rowIndex + r;
          const col = range.columnIndex + c;
          const targetCol = this.columnMap.get(col);
          const value = range.values[r][c];

          if (row > 0 && targetCol && value) {
            const cellKey = `${row}:${col}`;
            const oldValue = this.cellValues.get(cellKey);
            
            // Only process if value actually changed
            if (oldValue !== value) {
              this.cellValues.set(cellKey, value);
              ws.getRangeByIndexes(row, col, 1, 1).format.fill.color = "#FFFB9D";
              tasks.push(() => this.processCell(ws, row, col, targetCol, value));
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

      const target = result?.target || "No matches found";
      const confidence = result?.confidence || 0;
      const method = result?.method || (result ? "match" : "no_match");

      // Update cells
      const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
      const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

      tgtCell.values = [[target]];
      tgtCell.format.fill.color = this.getRelevanceColor(confidence);
      srcCell.format.fill.clear();

      // Log activity
      ActivityFeed.add(value, target, method, confidence);
      logActivity(value, target, method, confidence, result?.total_time || 0);
    } catch (error) {
      this.handleCellError(ws, row, col, targetCol, value, error);
    }
  }

  handleCellError(ws, row, col, targetCol, value, error) {
    const errorMsg = `Error: ${error.message}`;
    const srcCell = ws.getRangeByIndexes(row, col, 1, 1);
    const tgtCell = ws.getRangeByIndexes(row, targetCol, 1, 1);

    tgtCell.values = [[errorMsg]];
    tgtCell.format.fill.color = "#FFC7CE";
    srcCell.format.fill.color = "#FFC7CE";

    ActivityFeed.add(value, errorMsg, "error", 0);
    logActivity(value, errorMsg, "error", 0, 0);
  }

  applyChoice = async (ws, row, col, targetCol, value, choice) => {
    await Excel.run(async (ctx) => {
      const tgtCell = ctx.workbook.worksheets.getActiveWorksheet().getRangeByIndexes(row, targetCol, 1, 1);
      const srcCell = ctx.workbook.worksheets.getActiveWorksheet().getRangeByIndexes(row, col, 1, 1);

      tgtCell.values = [[choice.candidate]];
      tgtCell.format.fill.color = this.getRelevanceColor(choice.relevance_score);
      srcCell.format.fill.clear();

      ActivityFeed.add(value, choice.candidate, "UserChoice", choice.relevance_score);
      logActivity(value, choice.candidate, "UserChoice", choice.relevance_score, 0);

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
