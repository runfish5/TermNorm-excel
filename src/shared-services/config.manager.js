// shared-services/config.manager.js
import configData from '../../config/app.config.json';
import { state } from './state.manager.js';

export class ConfigManager {
    constructor() {
        this.rawConfigData = null;
    }

    async loadConfig() {
        try {
            const workbook = await Excel.run(async (context) => {
                const wb = context.workbook;
                wb.load("name");
                await context.sync();
                return wb.name;
            });

            // Use rawConfigData if set via setConfig, otherwise use imported configData
            const currentConfigData = this.rawConfigData || configData;

            if (!currentConfigData?.["excel-projects"]) {
                throw new Error("Configuration file not found or invalid structure");
            }

            const config = currentConfigData["excel-projects"][workbook] || currentConfigData["excel-projects"]["*"];
            
            if (!config?.standard_mappings || !Array.isArray(config.standard_mappings) || config.standard_mappings.length === 0) {
                throw new Error(`No valid configuration found for workbook: ${workbook}`);
            }

            // Validate that all mappings have required fields
            for (let i = 0; i < config.standard_mappings.length; i++) {
                const mapping = config.standard_mappings[i];
                if (!mapping?.mapping_reference) {
                    throw new Error(`Mapping ${i + 1} is missing mapping_reference`);
                }
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

    // Get all standard mappings
    getStandardMappings() {
        const config = this.getConfig();
        return config?.standard_mappings || [];
    }

    // Set config data (used by drag-and-drop)
    setConfig(configData) {
        this.rawConfigData = configData;
    }

    // Get count of excel-projects
    getExcelProjectsCount() {
        const currentConfigData = this.rawConfigData || configData;
        const excelProjects = currentConfigData?.["excel-projects"];
        return excelProjects ? Object.keys(excelProjects).length : 0;
    }
}