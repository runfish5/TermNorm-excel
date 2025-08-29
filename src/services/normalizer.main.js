// ./services/normalizer.handler.js
import { ActivityFeed } from '../ui-components/ActivityFeedUI.js';
import { ActivityDisplay } from '../ui-components/CandidateRankingUI.js';
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
        
        this.columnMap = await this.resolveColumnIndices(config.column_map);
        this.processor = new NormalizerRouter(mappings.forward, mappings.reverse, config);
        
        await Excel.run(async ctx => {
            const ws = ctx.workbook.worksheets.getActiveWorksheet();
            if (this.handler) ws.onChanged.remove(this.handler);
            this.handler = ws.onChanged.add(this.handleChange.bind(this));
            await ctx.sync();
        });
        
        this.active = true;
    }

    async resolveColumnIndices(colMap) {
        return await Excel.run(async ctx => {
            const headers = ctx.workbook.worksheets.getActiveWorksheet().getUsedRange(true).getRow(0);
            headers.load("values");
            await ctx.sync();
            
            const headerNames = headers.values[0].map(h => String(h || '').trim().toLowerCase());
            const cols = new Map();
            const missing = [];
            
            for (const [src, tgt] of Object.entries(colMap)) {
                const srcIdx = headerNames.indexOf(src.toLowerCase());
                const tgtIdx = headerNames.indexOf(tgt.toLowerCase());
                
                if (srcIdx === -1) missing.push(src);
                if (tgtIdx === -1) missing.push(tgt);
                else cols.set(srcIdx, tgtIdx);
            }
            
            if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);
            return cols;
        });
    }

    handleChange = async (e) => {
        if (!this.active) return;
        
        await Excel.run(async ctx => {
            const ws = ctx.workbook.worksheets.getActiveWorksheet();
            const range = ws.getRange(e.address);
            range.load("values, rowIndex, columnIndex, rowCount, columnCount");
            await ctx.sync();
            
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
            
            for (const task of tasks) {
                await task();
            }
            await ctx.sync();
        });
    }
    
    async processCell(ws, row, col, targetCol, value) {
        try {
            const result = await this.processor.process(value);
            console.log(`###################################################### variable result`);            
            console.log(`${JSON.stringify(result, null, 2)}`);         
            if (result) {
                if (result.candidates) {
                    ActivityDisplay.addCandidate(value, result, {
                        applyChoice: (choice) => this.applyChoice(ws, row, col, targetCol, value, choice)
                    });
                }
                this.applyResult(ws, row, col, targetCol, value, result);
            } else {
                ws.getRangeByIndexes(row, col, 1, 1).format.fill.clear();
                ActivityFeed.add(value, 'No matches found', 'no_match', 0);
                logActivity(value, 'No matches found', 'no_match', 0);
            }
            
        } catch (error) {
            ws.getRangeByIndexes(row, col, 1, 1).format.fill.color = "#FFC7CE";
            ws.getRangeByIndexes(row, targetCol, 1, 1).values = [[`Error: ${error.message}`]];
            ActivityFeed.add(value, `Error: ${error.message}`, 'error', 0);
            logActivity(value, `Error: ${error.message}`, 'error', 0);
        }
    }

    applyResult(ws, row, col, targetCol, value, result) {
        ws.getRangeByIndexes(row, targetCol, 1, 1).values = [[result.target]];
        ActivityFeed.add(value, result.target, result.method, result.confidence);
        logActivity(value, result.target, result.method, result.confidence);
        ws.getRangeByIndexes(row, col, 1, 1).format.fill.clear();
    }

    applyChoice = async (ws, row, col, targetCol, value, choice) => {
        await Excel.run(async ctx => {
            const worksheet = ctx.workbook.worksheets.getActiveWorksheet();
            const choiceResult = {
                target: choice.candidate,
                method: 'UserChoice',
                confidence: choice.relevance_score
            };
            this.applyResult(worksheet, row, col, targetCol, value, choiceResult);
            await ctx.sync();
        });
    }

    stop() {
        this.active = false;
    }

    static setup() {
        ActivityDisplay.init();
    }
}