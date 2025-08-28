// shared-services/config.manager.js
import configData from '../../config/app.config.json';
import { state } from './state.manager.js';
import { CloudConfigService } from './cloud-config.js';

export class ConfigManager {
    constructor() {
        this.cloudConfig = new CloudConfigService();
        this.configNeedsSetup = false;
    }

    async loadConfig() {
        try {
            const workbook = await this.cloudConfig.getWorkbookName();
            
            // Check if we're in cloud environment
            if (this.cloudConfig.isCloudEnvironment()) {
                return await this.loadCloudConfig(workbook);
            } else {
                return await this.loadLocalConfig(workbook);
            }
        } catch (error) {
            console.error("Config load error:", error);
            throw error;
        }
    }

    async loadLocalConfig(workbook) {
        if (!configData?.["excel-projects"]) {
            throw new Error("Configuration file not found or invalid structure");
        }

        const config = configData["excel-projects"][workbook] || configData["excel-projects"]["*"];
        return this.processAndValidateConfig(config, workbook);
    }

    async loadCloudConfig(workbook) {
        // First, try to get stored config location
        const storedLocation = await this.cloudConfig.getStoredConfigLocation();
        
        if (storedLocation) {
            try {
                // Try to load from stored location
                const cloudConfigData = await this.cloudConfig.loadConfigFromUrl(storedLocation);
                const config = cloudConfigData["excel-projects"][workbook] || cloudConfigData["excel-projects"]["*"];
                
                // Cache the config data
                this.cloudConfig.cacheConfigData(cloudConfigData);
                
                return this.processAndValidateConfig(config, workbook);
            } catch (error) {
                console.error("Failed to load from stored location:", error);
                // Clear invalid cached location
                await this.clearStoredConfig();
            }
        }

        // Try to load from cache
        const cachedConfig = this.cloudConfig.getCachedConfigData();
        if (cachedConfig) {
            try {
                const config = cachedConfig["excel-projects"][workbook] || cachedConfig["excel-projects"]["*"];
                return this.processAndValidateConfig(config, workbook);
            } catch (error) {
                console.error("Cached config is invalid:", error);
                this.cloudConfig.clearCache();
            }
        }

        // No valid config found, need to set up
        this.configNeedsSetup = true;
        throw new Error("Cloud configuration required. Please select your config file from SharePoint or OneDrive.");
    }

    processAndValidateConfig(config, workbook) {
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
    }

    async setupCloudConfig(configSource) {
        try {
            let configData;
            
            if (configSource.type === 'url') {
                // Convert SharePoint sharing link if necessary
                const directUrl = this.cloudConfig.convertSharePointLinkToDirectUrl(configSource.url);
                configData = await this.cloudConfig.loadConfigFromUrl(directUrl);
                
                // Store the location for future use
                await this.cloudConfig.storeConfigLocation(directUrl);
            } else if (configSource.type === 'file') {
                configData = await this.cloudConfig.handleFileUpload(configSource.file);
                
                // For uploaded files, we can't store a permanent location
                // but we cache the data
            }
            
            // Cache the config data
            this.cloudConfig.cacheConfigData(configData);
            
            // Validate and load the config
            const workbook = await this.cloudConfig.getWorkbookName();
            const config = configData["excel-projects"][workbook] || configData["excel-projects"]["*"];
            
            this.configNeedsSetup = false;
            return this.processAndValidateConfig(config, workbook);
        } catch (error) {
            console.error("Failed to setup cloud config:", error);
            throw error;
        }
    }

    async clearStoredConfig() {
        try {
            await Excel.run(async (context) => {
                const customProps = context.workbook.properties.custom;
                const configProp = customProps.getItemOrNullObject(this.cloudConfig.CONFIG_PROPERTY_KEY);
                await context.sync();
                
                if (!configProp.isNullObject) {
                    configProp.delete();
                    await context.sync();
                }
            });
            
            this.cloudConfig.clearCache();
            return true;
        } catch (error) {
            console.error("Failed to clear stored config:", error);
            return false;
        }
    }

    needsCloudSetup() {
        return this.configNeedsSetup;
    }

    getConfig() { 
        return state.get('config.data');
    }

    // Get all standard mappings
    getStandardMappings() {
        const config = this.getConfig();
        return config?.standard_mappings || [];
    }
}