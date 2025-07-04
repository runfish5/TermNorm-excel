// ./services/normalizer.handler.js
import { ActivityFeed } from '../ui-components/ActivityFeedUI.js';
import { CandidateRankingUI } from '../ui-components/CandidateRankingUI.js';
import { NormalizerRouter } from './normalizer.router.js';
import { logActivity } from '../shared-services/activity.logger.js';

export class LiveTracker {
    constructor() {
        this.active = false;
        this.handler = null;
        this.processor = null;
        this.columnMap = new Map();
    }

    async start(config, mappings) {
        if (!config?.column_map || !mappings) {
            throw new Error("Config and mappings required");
        }
        this.columnMap = await config.setupCols(config.column_map);
        this.processor = new NormalizerRouter(mappings.forward, mappings.reverse, config);
        await Excel.run(async ctx => {
            const ws = ctx.workbook.worksheets.getActiveWorksheet();
            if (this.handler) ws.onChanged.remove(this.handler);
            this.handler = ws.onChanged.add(this.handleChange.bind(this));
            await ctx.sync();
        });
        this.active = true;
    }

    handleChange = async (e) => {
        if (!this.active) return;
        await Excel.run(async ctx => {
            const ws = ctx.workbook.worksheets.getActiveWorksheet();
            const range = ws.getRange(e.address);
            range.load("values, rowIndex, columnIndex, rowCount, columnCount");
            await ctx.sync();
            // Apply visual feedback immediately
            const tasks = [];
            for (let r = 0; r < range.rowCount; r++) {
                for (let c = 0; c < range.columnCount; c++) {
                    const row = range.rowIndex + r;
                    const col = range.columnIndex + c;
                    const targetCol = this.columnMap.get(col);
                    const value = range.values[r][c];
                    if (row > 0 && targetCol && value) {
                        ws.getRangeByIndexes(row, col, 1, 1).format.fill.color = "#FFFB9D";
                        tasks.push(() => this.processCell(ws, row, col, targetCol, value));
                    }
                }
            }
            await ctx.sync();
            // Process all cells
            for (const task of tasks) {
                await task();
            }
            await ctx.sync();
        });
    }

    async processCell(ws, row, col, targetCol, value) {
        try {
            const result = await this.processor.process(value);
            CandidateRankingUI.add(value, result);
            
            let finalResult;
            
            if (result && result.type === 'multiple_matches') {
                const bestMatch = this.processor.selectBestMatch(result.matches, result.fullResults);
                finalResult = {
                    target: bestMatch[0],
                    method: result.method,
                    confidence: bestMatch[1]
                };
            } else {
                finalResult = result;
            }
            
            if (finalResult) {
                ws.getRangeByIndexes(row, targetCol, 1, 1).values = [[finalResult.target]];
                ActivityFeed.add(value, finalResult.target, finalResult.method, finalResult.confidence);
                logActivity(value, finalResult.target, finalResult.method, finalResult.confidence);
            }
            ws.getRangeByIndexes(row, col, 1, 1).format.fill.clear();
        } catch (error) {
            ws.getRangeByIndexes(row, col, 1, 1).format.fill.color = "#FFC7CE";
            ws.getRangeByIndexes(row, targetCol, 1, 1).values = [[`Error: ${error.message}`]];
            ActivityFeed.add(value, `Error: ${error.message}`, 'error', 0);
            logActivity(value, `Error: ${error.message}`, 'error', 0);
        }
    }

    stop() {
        this.active = false;
    }

    static setup() {
        ActivityFeed.init();
        CandidateRankingUI.init();
    }
}