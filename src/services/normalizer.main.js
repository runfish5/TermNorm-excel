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
        
        // Resolve column indices directly here - simple and direct!
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

    // Simple, direct column resolution - no dependencies!
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
            
            console.log(`${JSON.stringify(result, null, 2)}`);
            
            // Pass context directly to UI - no stored state needed!
            ActivityDisplay.addCandidate(value, result, {
                applyChoice: (choice) => this.applyChoice(ws, row, col, targetCol, value, choice)
            });
            
            let finalResult;
            
            if (result && result.type === 'multiple_matches') {
                // Simply take the first match - no need for selectBestMatch function
                const bestMatch = result.matches[0];
                
                console.log('\n### Best match selected \n\n', bestMatch);
                console.log(`${JSON.stringify(bestMatch, null, 2)}`);

                finalResult = {
                    target: bestMatch[0],
                    method: result.method,
                    confidence: bestMatch[1]
                };
            } else {
                finalResult = result;
            }
            
            if (finalResult) {
                this.applyResult(ws, row, col, targetCol, value, finalResult);
            }
            
        } catch (error) {
            ws.getRangeByIndexes(row, col, 1, 1).format.fill.color = "#FFC7CE";
            ws.getRangeByIndexes(row, targetCol, 1, 1).values = [[`Error: ${error.message}`]];
            ActivityFeed.add(value, `Error: ${error.message}`, 'error', 0);
            logActivity(value, `Error: ${error.message}`, 'error', 0);
        }
    }

    // Extract the result application logic to reuse for first choice
    applyResult(ws, row, col, targetCol, value, finalResult) {
        ws.getRangeByIndexes(row, targetCol, 1, 1).values = [[finalResult.target]];
        ActivityFeed.add(value, finalResult.target, finalResult.method, finalResult.confidence);
        logActivity(value, finalResult.target, finalResult.method, finalResult.confidence);
        ws.getRangeByIndexes(row, col, 1, 1).format.fill.clear();
    }

    // Simplified choice application - context passed directly
    applyChoice = async (ws, row, col, targetCol, value, choice) => {
        await Excel.run(async ctx => {
            const worksheet = ctx.workbook.worksheets.getActiveWorksheet();
            
            const finalResult = {
                target: choice.candidate,
                method: 'FirstChoice',
                confidence: choice.relevance_score
            };
            
            console.log('\n### First Choice Applied \n\n', finalResult);
            console.log(`${JSON.stringify(finalResult, null, 2)}`);
            
            this.applyResult(worksheet, row, col, targetCol, value, finalResult);
            
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