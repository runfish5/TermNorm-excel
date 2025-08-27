// shared-services/environment.detector.js

export class EnvironmentDetector {
    static isExcelOnline() {
        try {
            if (typeof Office === 'undefined' || !Office.context) {
                return false;
            }
            
            // Check if we're in Excel Online
            return Office.context.host === Office.HostType.Excel && 
                   Office.context.platform === Office.PlatformType.OfficeOnline;
        } catch (error) {
            console.warn('Environment detection failed:', error);
            return false;
        }
    }
    
    static isExcelDesktop() {
        try {
            if (typeof Office === 'undefined' || !Office.context) {
                return false;
            }
            
            // Check if we're in Excel Desktop
            return Office.context.host === Office.HostType.Excel && 
                   Office.context.platform !== Office.PlatformType.OfficeOnline;
        } catch (error) {
            console.warn('Environment detection failed:', error);
            return false;
        }
    }
    
    static getEnvironmentInfo() {
        try {
            if (typeof Office === 'undefined' || !Office.context) {
                return {
                    host: 'unknown',
                    platform: 'unknown',
                    isOnline: false,
                    isDesktop: false
                };
            }
            
            const isOnline = this.isExcelOnline();
            const isDesktop = this.isExcelDesktop();
            
            return {
                host: Office.context.host,
                platform: Office.context.platform,
                isOnline,
                isDesktop,
                requiresCloudConfig: isOnline
            };
        } catch (error) {
            console.error('Failed to get environment info:', error);
            return {
                host: 'error',
                platform: 'error',
                isOnline: false,
                isDesktop: false,
                requiresCloudConfig: false
            };
        }
    }
}