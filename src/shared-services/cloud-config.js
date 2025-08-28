// shared-services/cloud-config.js
/* global Office, Excel */

export class CloudConfigService {
    constructor() {
        this.CONFIG_PROPERTY_KEY = 'TermNorm_ConfigLocation';
        this.CONFIG_CACHE_KEY = 'TermNorm_ConfigCache';
    }

    /**
     * Check if running in cloud environment
     */
    isCloudEnvironment() {
        return Office.context?.platform === Office.PlatformType.OfficeOnline;
    }

    /**
     * Get stored config location from Excel custom properties
     */
    async getStoredConfigLocation() {
        try {
            return await Excel.run(async (context) => {
                const customProps = context.workbook.properties.custom;
                const configProp = customProps.getItemOrNullObject(this.CONFIG_PROPERTY_KEY);
                customProps.load();
                await context.sync();
                
                if (!configProp.isNullObject) {
                    configProp.load("value");
                    await context.sync();
                    return configProp.value;
                }
                return null;
            });
        } catch (error) {
            console.error('Failed to get stored config location:', error);
            return null;
        }
    }

    /**
     * Store config location in Excel custom properties
     */
    async storeConfigLocation(location) {
        try {
            return await Excel.run(async (context) => {
                const customProps = context.workbook.properties.custom;
                customProps.add(this.CONFIG_PROPERTY_KEY, location);
                await context.sync();
                return true;
            });
        } catch (error) {
            console.error('Failed to store config location:', error);
            return false;
        }
    }

    /**
     * Cache config data in browser storage
     */
    cacheConfigData(configData) {
        try {
            localStorage.setItem(this.CONFIG_CACHE_KEY, JSON.stringify(configData));
            return true;
        } catch (error) {
            console.error('Failed to cache config data:', error);
            return false;
        }
    }

    /**
     * Get cached config data
     */
    getCachedConfigData() {
        try {
            const cached = localStorage.getItem(this.CONFIG_CACHE_KEY);
            return cached ? JSON.parse(cached) : null;
        } catch (error) {
            console.error('Failed to get cached config:', error);
            return null;
        }
    }

    /**
     * Clear cached config data
     */
    clearCache() {
        try {
            localStorage.removeItem(this.CONFIG_CACHE_KEY);
            return true;
        } catch (error) {
            console.error('Failed to clear cache:', error);
            return false;
        }
    }

    /**
     * Load config from a SharePoint/OneDrive URL
     */
    async loadConfigFromUrl(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const configData = await response.json();
            
            // Validate config structure
            if (!configData?.["excel-projects"]) {
                throw new Error("Invalid config file structure");
            }
            
            return configData;
        } catch (error) {
            console.error('Failed to load config from URL:', error);
            throw new Error(`Failed to load config from URL: ${error.message}`);
        }
    }

    /**
     * Parse SharePoint sharing link to direct download URL
     */
    convertSharePointLinkToDirectUrl(shareLink) {
        try {
            // SharePoint sharing links typically look like:
            // https://company.sharepoint.com/:u:/g/personal/user_company_com/ExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxB
            
            if (shareLink.includes('sharepoint.com') && shareLink.includes('/:')) {
                // Extract base URL and encode the sharing link
                const baseUrl = shareLink.split('/:')[0];
                const encodedUrl = encodeURIComponent(shareLink);
                return `${baseUrl}/_api/v2.0/shares/u!${btoa(shareLink).replace(/=+$/, '')}/driveItem/content`;
            }
            
            // If it's already a direct URL, return as is
            return shareLink;
        } catch (error) {
            console.error('Failed to convert SharePoint link:', error);
            return shareLink;
        }
    }

    /**
     * Handle file upload via input element
     */
    async handleFileUpload(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = (e) => {
                try {
                    const configData = JSON.parse(e.target.result);
                    
                    // Validate config structure
                    if (!configData?.["excel-projects"]) {
                        reject(new Error("Invalid config file structure"));
                        return;
                    }
                    
                    resolve(configData);
                } catch (error) {
                    reject(new Error("Failed to parse config file: " + error.message));
                }
            };
            
            reader.onerror = () => reject(new Error("Failed to read file"));
            reader.readAsText(file);
        });
    }

    /**
     * Validate config data structure
     */
    validateConfigData(configData) {
        if (!configData || typeof configData !== 'object') {
            throw new Error("Config data is not a valid object");
        }

        if (!configData["excel-projects"]) {
            throw new Error("Config missing 'excel-projects' section");
        }

        // Additional validation can be added here
        return true;
    }

    /**
     * Get workbook name for config lookup
     */
    async getWorkbookName() {
        return await Excel.run(async (context) => {
            const wb = context.workbook;
            wb.load("name");
            await context.sync();
            return wb.name;
        });
    }
}