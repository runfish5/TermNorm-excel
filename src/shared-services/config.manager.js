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
            
            if (!config?.standard_mappings || !Array.isArray(config.standard_mappings) || config.standard_mappings.length === 0) {
                throw new Error(`No valid configuration found for workbook: ${workbook}`);
            }

            // Check if the first mapping has required fields
            const firstMapping = config.standard_mappings[0];
            if (!firstMapping?.mapping_reference) {
                throw new Error(`No valid mapping reference found in configuration for workbook: ${workbook}`);
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

    // Get the first standard mapping (for backward compatibility)
    getFirstStandardMapping() {
        const config = this.getConfig();
        return config?.standard_mappings?.[0] || {};
    }

    getFileName() {
        return this.parseFileName(this.getFirstStandardMapping()?.mapping_reference) || '';
    }

    parseFileName(path) {
        return path?.split(/[\\/]/).pop();
    }

    isExternal() {
        const config = this.getConfig();
        if (!config) return false;
        
        const firstMapping = this.getFirstStandardMapping();
        const ref = firstMapping?.mapping_reference;
        return ref && (ref.includes('/') || ref.includes('\\') || !config.workbook.includes(this.parseFileName(ref)));
    }

    getWorksheet() {
        return this.getFirstStandardMapping()?.worksheet || '';
    }

    getSourceColumn() {
        return this.getFirstStandardMapping()?.source_column || '';
    }

    getTargetColumn() {
        return this.getFirstStandardMapping()?.target_column || '';
    }

    getMappingReference() {
        return this.getFirstStandardMapping()?.mapping_reference || '';
    }
}