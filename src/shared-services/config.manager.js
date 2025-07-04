// ./shared-services/config.manager.js
import configData from '../../config/app.config.json';

export class ConfigManager {
    constructor() {
        this.config = null;
    }

    async loadConfig() {
        let workbook;
        
        try {
            workbook = await Excel.run(async (context) => {
                const wb = context.workbook;
                wb.load("name");
                await context.sync();
                return wb.name;
            });
        } catch (error) {
            throw new Error("Excel file not found or could not be accessed");
        }

        // Check if configData exists
        if (!configData || !configData["excel-projects"]) {
            throw new Error("Configuration file not found or invalid structure");
        }

        const config = configData["excel-projects"]?.[workbook] || configData["excel-projects"]?.["*"];
        
        if (!config) {
            throw new Error(`No configuration found for workbook: ${workbook}`);
        }
        
        if (!config.mapping_reference) {
            throw new Error(`Configuration found but missing required 'mapping_reference' property for workbook: ${workbook}`);
        }

        this.config = { 
            ...config, 
            workbook,
            setupCols: this.setupCols.bind(this)
        };
        return this.config;
    }

    getConfig() { return this.config; }

    isExternal() {
        const ref = this.config?.mapping_reference;
        return ref && (ref.includes('/') || ref.includes('\\') || !this.config.workbook.includes(ref.split(/[\\/]/).pop()));
    }

    getFileName() {
        return this.config?.mapping_reference?.split(/[\\/]/).pop() || '';
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