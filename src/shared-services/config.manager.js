// ./shared-services/config.manager.js
import configData from '../../config/app.config.json';

export class ConfigManager {
    constructor() {
        this.config = null;
    }

    async loadConfig() {
        try {
            const workbook = await Excel.run(async (context) => {
                const wb = context.workbook;
                wb.load("name");
                await context.sync();
                return wb.name;
            });

            if (!configData?.["excel-projects"]) {
                throw new Error("Configuration file not found or invalid structure");
            }

            const config = configData["excel-projects"][workbook] || configData["excel-projects"]["*"];
            
            if (!config?.mapping_reference) {
                throw new Error(`No valid configuration found for workbook: ${workbook}`);
            }

            this.config = { ...config, workbook, setupCols: this.setupCols.bind(this) };
            return this.config;

        } catch (error) {
            if (error.message.includes("Excel file")) throw error;
            throw new Error("Excel file not found or could not be accessed");
        }
    }

    getConfig() { 
        return this.config; 
    }

    getFileName() {
        return this.parseFileName(this.config?.mapping_reference) || '';
    }

    parseFileName(path) {
        return path?.split(/[\\/]/).pop();
    }

    isExternal() {
        const ref = this.config?.mapping_reference;
        return ref && (ref.includes('/') || ref.includes('\\') || !this.config.workbook.includes(this.parseFileName(ref)));
    }

    getWorksheet() {
        return this.config?.worksheet || '';
    }

    async setupCols(colMap) {
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
}