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

            this.config = { ...config, workbook };
            return this.config;

        } catch (error) {
            console.error("Config load error:", error);
            throw error;
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
}