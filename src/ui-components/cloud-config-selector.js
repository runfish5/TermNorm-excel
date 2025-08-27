// ui-components/cloud-config-selector.js
import { EnvironmentDetector } from '../shared-services/environment.detector.js';

export class CloudConfigSelector {
    constructor() {
        this.configUrl = null;
        this.isVisible = false;
    }

    show() {
        if (this.isVisible) return Promise.resolve(this.configUrl);
        
        return new Promise((resolve, reject) => {
            const envInfo = EnvironmentDetector.getEnvironmentInfo();
            
            // Create the dialog overlay
            const overlay = document.createElement('div');
            overlay.className = 'cloud-config-overlay';
            overlay.innerHTML = `
                <div class="cloud-config-dialog">
                    <div class="cloud-config-header">
                        <h2 class="ms-font-xl">📁 Select Configuration File</h2>
                        <p class="ms-font-m">You're using Excel ${envInfo.isOnline ? 'Online' : 'Desktop'}. Please provide the location of your configuration file.</p>
                    </div>
                    
                    <div class="cloud-config-content">
                        <div class="config-option">
                            <h3 class="ms-font-l">☁️ Cloud Configuration File</h3>
                            <p class="ms-font-s">Paste the SharePoint/OneDrive URL to your app.config.json file:</p>
                            <input type="url" 
                                   id="cloud-config-url" 
                                   placeholder="https://contoso.sharepoint.com/.../app.config.json" 
                                   class="config-url-input" />
                            <div class="url-help">
                                <details class="ms-font-xs">
                                    <summary>How to get the file URL</summary>
                                    <ol>
                                        <li>Upload your app.config.json to SharePoint or OneDrive</li>
                                        <li>Right-click the file → "Copy link"</li>
                                        <li>Paste the URL above</li>
                                    </ol>
                                </details>
                            </div>
                        </div>
                        
                        ${!envInfo.isOnline ? `
                        <div class="config-option">
                            <h3 class="ms-font-l">💻 Local Configuration File</h3>
                            <p class="ms-font-s">Use local file (Excel Desktop only):</p>
                            <button id="use-local-config" class="ms-Button">Use Local Config</button>
                        </div>
                        ` : ''}
                    </div>
                    
                    <div class="cloud-config-actions">
                        <button id="config-url-ok" class="ms-Button ms-Button--primary" disabled>Load Configuration</button>
                        <button id="config-url-cancel" class="ms-Button">Cancel</button>
                    </div>
                    
                    <div class="environment-info ms-font-xs">
                        Environment: ${envInfo.host} on ${envInfo.platform}
                    </div>
                </div>
            `;
            
            document.body.appendChild(overlay);
            this.isVisible = true;
            
            // Get elements
            const urlInput = document.getElementById('cloud-config-url');
            const okButton = document.getElementById('config-url-ok');
            const cancelButton = document.getElementById('config-url-cancel');
            const useLocalButton = document.getElementById('use-local-config');
            
            // Enable/disable OK button based on input
            urlInput.addEventListener('input', () => {
                const isValidUrl = this.isValidConfigUrl(urlInput.value.trim());
                okButton.disabled = !isValidUrl;
                okButton.textContent = isValidUrl ? 'Load Configuration' : 'Enter Valid URL';
            });
            
            // Handle OK button
            okButton.onclick = () => {
                const url = urlInput.value.trim();
                if (this.isValidConfigUrl(url)) {
                    this.configUrl = url;
                    this.cleanup(overlay);
                    resolve({ type: 'cloud', url });
                }
            };
            
            // Handle Cancel button
            cancelButton.onclick = () => {
                this.cleanup(overlay);
                reject(new Error('Config selection cancelled'));
            };
            
            // Handle Use Local button (Desktop only)
            if (useLocalButton) {
                useLocalButton.onclick = () => {
                    this.cleanup(overlay);
                    resolve({ type: 'local', url: null });
                };
            }
            
            // Auto-focus the input
            setTimeout(() => urlInput.focus(), 100);
        });
    }
    
    isValidConfigUrl(url) {
        if (!url) return false;
        
        try {
            const urlObj = new URL(url);
            
            // Check if it's a cloud URL (SharePoint/OneDrive/Office.com)
            const isCloudDomain = urlObj.hostname.includes('sharepoint.com') || 
                                 urlObj.hostname.includes('onedrive.') || 
                                 urlObj.hostname.includes('office.com') ||
                                 urlObj.hostname.includes('officeapps.live.com');
            
            // Check if it looks like a JSON config file
            const isJsonFile = urlObj.pathname.toLowerCase().endsWith('.json') ||
                              url.toLowerCase().includes('config');
            
            return urlObj.protocol.startsWith('http') && (isCloudDomain || isJsonFile);
        } catch {
            return false;
        }
    }
    
    cleanup(overlay) {
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        this.isVisible = false;
    }
    
    getLastSelectedUrl() {
        return this.configUrl;
    }
}