// shared-services/config.manager.js
import { state } from './state.manager.js';

export class ConfigManager {
    constructor() {
        this.configCache = null;
    }

    async loadConfig(configSource = null) {
        try {
            const workbook = await Excel.run(async (context) => {
                const wb = context.workbook;
                wb.load("name");
                await context.sync();
                return wb.name;
            });

            // Try to load config using specified source or defaults
            const configData = await this.fetchConfig(workbook, configSource);

            if (!configData?.["excel-projects"]) {
                throw new Error("Configuration file not found or invalid structure");
            }

            const config = configData["excel-projects"][workbook] || configData["excel-projects"]["*"];
            
            if (!config?.standard_mappings || !Array.isArray(config.standard_mappings) || config.standard_mappings.length === 0) {
                throw new Error(`No valid configuration found for workbook: ${workbook}`);
            }

            // Validate and enhance mappings with file type detection
            for (let i = 0; i < config.standard_mappings.length; i++) {
                const mapping = config.standard_mappings[i];
                if (!mapping?.mapping_reference) {
                    throw new Error(`Mapping ${i + 1} is missing mapping_reference`);
                }
                
                // Add file type detection
                mapping.file_type = this.detectFileType(mapping.mapping_reference);
            }

            const enhancedConfig = { ...config, workbook };
            state.setConfig(enhancedConfig);
            this.configCache = enhancedConfig;
            
            return enhancedConfig;
        } catch (error) {
            console.error("Config load error:", error);
            throw error;
        }
    }

    async fetchConfig(workbook, configSource = null) {
        // If specific config source provided, use it
        if (configSource) {
            if (configSource.type === 'cloud' && configSource.url) {
                return await this.fetchCloudConfig(workbook, configSource.url);
            } else if (configSource.type === 'local') {
                return await this.fetchLocalConfig();
            }
        }

        // Try default cloud config API first
        try {
            const response = await fetch('http://127.0.0.1:8000/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workbook })
            });
            
            if (response.ok) {
                const cloudConfig = await response.json();
                console.log('Loaded config from default cloud API');
                return cloudConfig;
            }
        } catch (cloudError) {
            console.warn('Default cloud config failed, trying local fallback:', cloudError.message);
        }

        // Fallback to local config file
        return await this.fetchLocalConfig();
    }

    async fetchCloudConfig(workbook, configUrl) {
        try {
            console.log(`Loading config from cloud URL: ${configUrl}`);
            
            // Use backend proxy to fetch cloud config file
            const response = await fetch('http://127.0.0.1:8000/config-from-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    workbook, 
                    configUrl 
                })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch cloud config: ${response.statusText}`);
            }
            
            const cloudConfig = await response.json();
            console.log('Loaded config from user-provided cloud URL');
            return cloudConfig;
        } catch (error) {
            console.error('Cloud config fetch error:', error);
            throw new Error(`Could not load cloud config: ${error.message}`);
        }
    }

    async fetchLocalConfig() {
        try {
            const response = await fetch('./config/app.config.json');
            if (response.ok) {
                const localConfig = await response.json();
                console.log('Loaded config from local file');
                return localConfig;
            }
            throw new Error('Local config file not found or not readable');
        } catch (localError) {
            console.warn('Local config failed:', localError.message);
            throw new Error('Could not load configuration from any source');
        }
    }

    detectFileType(reference) {
        if (!reference) return 'unknown';
        
        // Check for cloud URLs
        if (reference.startsWith('https://') && 
            (reference.includes('sharepoint.com') || reference.includes('onedrive.') || reference.includes('office.com'))) {
            return 'cloud';
        }
        
        // Check for local paths
        if (reference.includes('\\') || reference.includes('/')) {
            return 'local';
        }
        
        return 'unknown';
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