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
            console.log('Attempting to load config from URL:', url);
            
            const response = await fetch(url);
            
            if (!response.ok) {
                // Provide specific error messages for common issues
                if (response.status === 403) {
                    throw new Error("Access denied. Please check that 'People with access' or 'Anyone with the link' can view this file.");
                } else if (response.status === 404) {
                    throw new Error("File not found. Please check that the OneDrive link is correct and the file exists.");
                } else if (response.status === 401) {
                    throw new Error("Authentication required. Please check the sharing permissions of your OneDrive file.");
                } else {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
            }
            
            // Check if we got HTML instead of JSON (common with OneDrive preview pages)
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('text/html')) {
                throw new Error("Received HTML instead of JSON. Please ensure you're using a direct download link, not a preview link.");
            }
            
            const configData = await response.json();
            
            // Validate config structure
            if (!configData?.["excel-projects"]) {
                throw new Error("Invalid config file structure. Missing 'excel-projects' section.");
            }
            
            console.log('Successfully loaded config data');
            return configData;
        } catch (error) {
            console.error('Failed to load config from URL:', error);
            
            // If it's already our custom error, rethrow it
            if (error.message.includes('Access denied') || 
                error.message.includes('File not found') ||
                error.message.includes('Authentication required') ||
                error.message.includes('Received HTML')) {
                throw error;
            }
            
            // For JSON parsing errors, provide helpful message
            if (error.name === 'SyntaxError') {
                throw new Error("Invalid JSON file. Please check that your config file contains valid JSON data.");
            }
            
            throw new Error(`Failed to load config: ${error.message}`);
        }
    }

    /**
     * Convert various sharing links to direct download URLs
     */
    convertSharePointLinkToDirectUrl(shareLink) {
        try {
            // Handle different OneDrive/SharePoint link formats
            
            // 1. Modern OneDrive short links (1drv.ms)
            // Format: https://1drv.ms/u/c/ID/FILE?e=TOKEN
            if (shareLink.includes('1drv.ms')) {
                return this.convertOneDriveShortLink(shareLink);
            }
            
            // 2. Classic OneDrive links (onedrive.live.com)  
            // Format: https://onedrive.live.com/redir?resid=ID&authkey=TOKEN
            if (shareLink.includes('onedrive.live.com/redir')) {
                return shareLink.replace('/redir?', '/download?');
            }
            
            // 3. SharePoint corporate links
            // Format: https://company.sharepoint.com/:u:/g/personal/user_company_com/ExxxB
            if (shareLink.includes('sharepoint.com') && shareLink.includes('/:')) {
                return this.convertSharePointCorporateLink(shareLink);
            }
            
            // 4. Direct download links - return as is
            if (shareLink.includes('download=1') || shareLink.includes('/download?')) {
                return shareLink;
            }
            
            // If unknown format, try adding download parameter
            const separator = shareLink.includes('?') ? '&' : '?';
            return `${shareLink}${separator}download=1`;
            
        } catch (error) {
            console.error('Failed to convert sharing link:', error);
            return shareLink;
        }
    }

    /**
     * Convert modern OneDrive short links (1drv.ms format)
     */
    convertOneDriveShortLink(shareLink) {
        try {
            // Format: https://1drv.ms/u/c/0F398A63FF396AF9/AerwLGraTSFHtrETzoYivfE?e=7W8dQW
            // Add download parameter to get direct file content
            
            if (shareLink.includes('download=1')) {
                return shareLink; // Already a download link
            }
            
            const separator = shareLink.includes('?') ? '&' : '?';
            return `${shareLink}${separator}download=1`;
            
        } catch (error) {
            console.error('Failed to convert OneDrive short link:', error);
            return shareLink;
        }
    }

    /**
     * Convert SharePoint corporate sharing links
     */
    convertSharePointCorporateLink(shareLink) {
        try {
            // Format: https://company.sharepoint.com/:u:/g/personal/user_company_com/ExxxB
            const baseUrl = shareLink.split('/:')[0];
            const encodedUrl = encodeURIComponent(shareLink);
            return `${baseUrl}/_api/v2.0/shares/u!${btoa(shareLink).replace(/=+$/, '')}/driveItem/content`;
        } catch (error) {
            console.error('Failed to convert SharePoint corporate link:', error);
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