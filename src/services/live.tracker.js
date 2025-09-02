// ./services/live.tracker.js
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";
import { ActivityDisplay } from "../ui-components/CandidateRankingUI.js";
import { NormalizerRouter } from "./normalizer.router.js";
import { logActivity } from "../shared-services/activity.logger.js";
import { buildColumnMap } from "../utils/columnUtils.js";
import { createCellKey, hasValueChanged, cleanCellValue } from "../utils/cellUtils.js";
import {
  createCellUpdates,
  createErrorUpdates,
  createChoiceUpdates,
  applyCellUpdates,
  markCellPending,
} from "../utils/cellProcessor.js";

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
              markCellPending(ws, row, col);
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

      // Create cell updates using pure function
      const updates = createCellUpdates(value, result, row, col, targetCol);
      
      // Apply updates to Excel
      await applyCellUpdates(ws, updates);

      // Log activity
      ActivityFeed.add(updates.value, updates.target, updates.method, updates.confidence);
      logActivity(updates.value, updates.target, updates.method, updates.confidence, 
                 updates.metadata.total_time, updates.metadata.llm_provider);
    } catch (error) {
      this.handleCellError(ws, row, col, targetCol, value, error);
    }
  }

  async handleCellError(ws, row, col, targetCol, value, error) {
    // Create error updates using pure function
    const updates = createErrorUpdates(value, error, row, col, targetCol);
    
    // Apply updates to Excel
    await applyCellUpdates(ws, updates);

    // Log activity
    ActivityFeed.add(updates.value, updates.target, updates.method, updates.confidence);
    logActivity(updates.value, updates.target, updates.method, updates.confidence, 
               updates.metadata.total_time, updates.metadata.llm_provider);
  }

  applyChoice = async (ws, row, col, targetCol, value, choice) => {
    await Excel.run(async (ctx) => {
      // Create choice updates using pure function
      const updates = createChoiceUpdates(value, choice, row, col, targetCol);
      
      // Apply updates to Excel
      await applyCellUpdates(ctx.workbook.worksheets.getActiveWorksheet(), updates);

      // Log activity
      ActivityFeed.add(updates.value, updates.target, updates.method, updates.confidence);
      logActivity(updates.value, updates.target, updates.method, updates.confidence, 
                 updates.metadata.total_time, updates.metadata.llm_provider);

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
