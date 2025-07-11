// shared-services/config.manager.js
import configData from '../../config/app.config.json';
import { state } from './state.manager.js';

export class ConfigManager {
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

            const enhancedConfig = { ...config, workbook };
            state.setConfig(enhancedConfig);
            
            return enhancedConfig;
        } catch (error) {
            console.error("Config load error:", error);
            throw error;
        }
    }

    getConfig() { 
        return state.get('config.data');
    }

    getFileName() {
        return this.parseFileName(this.getConfig()?.mapping_reference) || '';
    }

    parseFileName(path) {
        return path?.split(/[\\/]/).pop();
    }

    isExternal() {
        const config = this.getConfig();
        if (!config) return false;
        
        const ref = config.mapping_reference;
        return ref && (ref.includes('/') || ref.includes('\\') || !config.workbook.includes(this.parseFileName(ref)));
    }

    getWorksheet() {
        return this.getConfig()?.worksheet || '';
    }
}