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

    // Get a specific mapping by index
    getStandardMapping(index) {
        const mappings = this.getStandardMappings();
        return mappings[index] || null;
    }

    // Get count of standard mappings
    getStandardMappingsCount() {
        return this.getStandardMappings().length;
    }

    // Utility methods for backward compatibility and general use
    parseFileName(path) {
        return path?.split(/[\\/]/).pop();
    }

    isExternalFile(mappingReference) {
        const config = this.getConfig();
        if (!config || !mappingReference) return false;
        
        return mappingReference && (mappingReference.includes('/') || mappingReference.includes('\\') || 
               !config.workbook.includes(this.parseFileName(mappingReference)));
    }

    // Methods for working with specific mappings
    getFileName(mappingIndex = 0) {
        const mapping = this.getStandardMapping(mappingIndex);
        return this.parseFileName(mapping?.mapping_reference) || '';
    }

    isExternal(mappingIndex = 0) {
        const mapping = this.getStandardMapping(mappingIndex);
        return mapping ? this.isExternalFile(mapping.mapping_reference) : false;
    }

    getWorksheet(mappingIndex = 0) {
        const mapping = this.getStandardMapping(mappingIndex);
        return mapping?.worksheet || '';
    }

    getSourceColumn(mappingIndex = 0) {
        const mapping = this.getStandardMapping(mappingIndex);
        return mapping?.source_column || '';
    }

    getTargetColumn(mappingIndex = 0) {
        const mapping = this.getStandardMapping(mappingIndex);
        return mapping?.target_column || '';
    }

    getMappingReference(mappingIndex = 0) {
        const mapping = this.getStandardMapping(mappingIndex);
        return mapping?.mapping_reference || '';
    }

    // Get workbook name
    getWorkbookName() {
        const config = this.getConfig();
        return config?.workbook || '';
    }

    // Get column map (remains at root level)
    getColumnMap() {
        const config = this.getConfig();
        return config?.column_map || {};
    }

    // Get default standard suffix
    getDefaultStdSuffix() {
        const config = this.getConfig();
        return config?.default_std_suffix || 'standardized';
    }

    // Validation helpers
    validateMapping(mappingIndex) {
        const mapping = this.getStandardMapping(mappingIndex);
        if (!mapping) {
            throw new Error(`Mapping ${mappingIndex + 1} not found`);
        }
        if (!mapping.mapping_reference) {
            throw new Error(`Mapping ${mappingIndex + 1} is missing mapping_reference`);
        }
        return mapping;
    }

    validateAllMappings() {
        const mappings = this.getStandardMappings();
        if (mappings.length === 0) {
            throw new Error("No standard mappings configured");
        }
        
        mappings.forEach((mapping, index) => {
            this.validateMapping(index);
        });
        
        return mappings;
    }

    // Summary info
    getConfigSummary() {
        const config = this.getConfig();
        if (!config) return null;
        
        return {
            workbook: config.workbook,
            mappingsCount: this.getStandardMappingsCount(),
            columnMapCount: Object.keys(this.getColumnMap()).length,
            defaultSuffix: this.getDefaultStdSuffix(),
            mappings: this.getStandardMappings().map((mapping, index) => ({
                index,
                worksheet: mapping.worksheet,
                fileName: this.parseFileName(mapping.mapping_reference),
                isExternal: this.isExternalFile(mapping.mapping_reference),
                sourceColumn: mapping.source_column,
                targetColumn: mapping.target_column
            }))
        };
    }
}