// ui-components/ui.manager.js
import { MappingConfigModule } from './mapping-config-module.js';
import { CandidateRankingUI } from './CandidateRankingUI.js';
import { state } from '../shared-services/state.manager.js';
import { LiveTracker } from '../services/normalizer.main.js';
import { ConfigManager } from '../shared-services/config.manager.js';

export class UIManager {
    constructor() {
        this.mappingModules = [];
        this.loadedMappings = new Map();
        this.tracker = new LiveTracker();
        this.configManager = new ConfigManager();
    }

    init() {
        this.setupEvents();
        CandidateRankingUI.init();
        this.showView('config');
        state.subscribe('ui', (ui) => this.updateStatus(ui.statusMessage, ui.isError));
        return this;
    }

    setupEvents() {
        const events = {
            'show-metadata-btn': () => {
                const content = document.getElementById('metadata-content');
                const isHidden = content?.classList.toggle('hidden');
                const label = document.querySelector('#show-metadata-btn .ms-Button-label');
                if (label) label.textContent = isHidden ? 'Show Processing Details' : 'Hide Processing Details';
            },
            'setup-map-tracking': () => this.startTracking(),
            'activate-tracking': (e) => {
                e.preventDefault();
                this.showView('tracking');
                this.startTracking();
            },
            'load-onedrive-config': () => this.loadOneDriveConfig()
        };
        
        Object.entries(events).forEach(([id, handler]) => 
            document.getElementById(id)?.addEventListener('click', handler));
    }

    showView(viewName) {
        ['config-div', 'tracking-div'].forEach(id => 
            document.getElementById(id)?.classList.toggle('hidden', !id.startsWith(viewName)));
        ['load-config', 'activate-tracking'].forEach(id => 
            document.getElementById(id)?.classList.toggle('ms-Button--primary', id.includes(viewName)));
        state.setView(viewName);
    }

    async reloadMappingModules() {
        const standardMappings = this.configManager.getStandardMappings();
        if (!standardMappings?.length) return;
        const container = document.getElementById('mapping-configs-container');
        if (!container) return console.error('Mapping configs container not found');
        
        container.innerHTML = '';
        this.mappingModules = [];
        this.loadedMappings.clear();
        this.mappingModules = standardMappings.map((config, index) => {
            const module = new MappingConfigModule(config, index, 
                (moduleIndex, mappings, result) => this.onMappingLoaded(moduleIndex, mappings, result));
            module.init(container);
            return module;
        });
        this.updateGlobalStatus();
    }

    onMappingLoaded(moduleIndex, mappings, result) {
        this.loadedMappings.set(moduleIndex, { mappings, result });
        this.updateGlobalStatus();
        this.updateJsonDump();
    }

    // Minimal JSON dump functionality
    updateJsonDump() {
        const content = document.getElementById('metadata-content');
        if (!content || this.loadedMappings.size === 0) return;

        const data = Array.from(this.loadedMappings.entries()).map(([index, { mappings, result }]) => ({
            sourceIndex: index + 1,
            forwardMappings: Object.keys(mappings.forward).length,
            reverseMappings: Object.keys(mappings.reverse).length,
            metadata: result.metadata,
            mappings: mappings
        }));

        content.innerHTML = `
            <div style="margin-top: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-family: monospace; font-size: 12px;">
                <strong>Raw Data:</strong>
                <pre style="margin: 5px 0; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(data, null, 2)}</pre>
            </div>`;
    }

    updateGlobalStatus() {
        const { size: loaded } = this.loadedMappings;
        const total = this.mappingModules.length;
        
        const message = loaded === 0 ? "Ready to load mapping configurations..." :
                    loaded === total ? `All ${total} mapping sources loaded` :
                    `${loaded}/${total} mapping sources loaded`;
        
        state.setStatus(message);
    }

    async startTracking() {
        const config = state.get('config.data');
        if (!config?.column_map || !Object.keys(config.column_map).length) 
            return state.setStatus("Error: Load config first", true);

        // Combine mappings if needed
        if (this.loadedMappings.size > 0) {
            const combined = Array.from(this.loadedMappings.entries()).reduce((acc, [index, { mappings, result }]) => {
                Object.assign(acc.forward, mappings.forward);
                Object.assign(acc.reverse, mappings.reverse);
                acc.metadata.sources.push({
                    index: index + 1,
                    config: this.mappingModules[index].getConfig(),
                    mappings, metadata: result.metadata
                });
                return acc;
            }, { forward: {}, reverse: {}, metadata: { sources: [] } });
            
            state.setMappings(combined.forward, combined.reverse, combined.metadata);
        }

        const mappings = state.get('mappings');
        const hasForward = mappings.forward && Object.keys(mappings.forward).length > 0;
        const hasReverse = mappings.reverse && Object.keys(mappings.reverse).length > 0;
        if (!hasForward && !hasReverse) return state.setStatus("Error: Load mappings first", true);

        try {
            await this.tracker.start(config, mappings);
            
            const forwardCount = Object.keys(mappings.forward || {}).length;
            const reverseCount = Object.keys(mappings.reverse || {}).length;
            const sourcesCount = mappings.metadata?.sources?.length || 0;
            
            let mode = hasForward ? "with mappings" : "reverse-only";
            if (sourcesCount > 1) mode += ` (${sourcesCount} sources)`;
            
            state.setStatus(`Tracking active ${mode} - ${forwardCount} forward, ${reverseCount} reverse`);
            this.showView('tracking');
        } catch (error) {
            state.setStatus(`Error: ${error.message}`, true);
        }
    }

    async loadOneDriveConfig() {
        const urlInput = document.getElementById('onedrive-url-input');
        if (!urlInput?.value) {
            state.setStatus("Please enter a OneDrive URL", true);
            return;
        }

        const url = urlInput.value.trim();
        if (!url.includes('1drv.ms') && !url.includes('sharepoint.com')) {
            state.setStatus("Invalid OneDrive URL format", true);
            return;
        }

        try {
            state.setStatus("Loading configuration from OneDrive...");
            
            // First, try using Office.js context for OneDrive access (if available)
            if (typeof Office !== 'undefined' && Office.context && Office.context.auth) {
                try {
                    console.log('Attempting Office.js authentication approach...');
                    const result = await this.tryOfficeAuth(url);
                    if (result) return result;
                } catch (authError) {
                    console.log('Office.js auth failed:', authError.message);
                }
            }
            
            // Fallback to direct URL approaches
            const urlAttempts = this.getAllUrlAttempts(url);
            console.log('Original URL:', url);
            console.log('Trying', urlAttempts.length, 'different URL formats...');
            
            let lastError = null;
            
            for (let i = 0; i < urlAttempts.length; i++) {
                const attemptUrl = urlAttempts[i];
                console.log(`Attempt ${i + 1}/${urlAttempts.length}:`, attemptUrl);
                
                try {
                    // Use standard CORS mode for all attempts - no-cors can't read response
                    let fetchOptions = {
                        method: 'GET',
                        credentials: 'include',
                        headers: {
                            'Accept': 'application/json, text/plain, */*'
                        }
                    };
                    
                    // For later attempts, try without credentials to see if that helps
                    if (i >= 4) {
                        fetchOptions.credentials = 'omit';
                        console.log(`Using credentials: 'omit' for attempt ${i + 1}`);
                    }
                    
                    const response = await fetch(attemptUrl, fetchOptions);
                    
                    console.log(`Attempt ${i + 1} response:`, {
                        ok: response.ok,
                        status: response.status,
                        statusText: response.statusText,
                        type: response.type,
                        url: response.url
                    });
                    
                    if (response.ok) {
                        console.log(`Processing response from attempt ${i + 1}...`);
                        
                        try {
                            let configData;
                            const contentType = response.headers.get('content-type');
                            console.log('Content-Type:', contentType);
                            
                            if (contentType && contentType.includes('application/json')) {
                                configData = await response.json();
                            } else {
                                const textData = await response.text();
                                console.log('Response text length:', textData.length);
                                console.log('Response text preview:', textData.substring(0, 200));
                                
                                try {
                                    configData = JSON.parse(textData);
                                } catch (parseError) {
                                    throw new Error("File is not valid JSON format");
                                }
                            }
                            
                            if (!configData || typeof configData !== 'object') {
                                throw new Error("Invalid configuration format");
                            }
                            
                            console.log('Successfully parsed config data');
                            this.configManager.setConfig(configData);
                            await this.reloadMappingModules();
                            state.setStatus("OneDrive configuration loaded successfully");
                            return; // Success!
                        } catch (processError) {
                            console.log(`Error processing response from attempt ${i + 1}:`, processError.message);
                            lastError = processError;
                        }
                    } else {
                        console.log(`Attempt ${i + 1} failed: HTTP ${response.status} ${response.statusText}`);
                        lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
                    }
                } catch (fetchError) {
                    console.log(`Attempt ${i + 1} failed:`, fetchError.message);
                    lastError = fetchError;
                }
            }
            
            // If we get here, all attempts failed
            let errorMessage = lastError?.message || "All URL conversion attempts failed";
            if (errorMessage.includes('Failed to fetch')) {
                errorMessage = "Network/CORS error - file may not be publicly accessible";
            }
            throw new Error(errorMessage);
        } catch (error) {
            console.error('OneDrive config load error:', error);
            
            // Provide more specific error messages
            let userMessage = error.message;
            if (error.message.includes('Failed to fetch')) {
                userMessage = "Network error - check URL and internet connection";
            } else if (error.message.includes('JSON')) {
                userMessage = "File format error - ensure it's a valid JSON configuration";
            }
            
            state.setStatus(`Failed to load OneDrive config: ${userMessage}`, true);
        }
    }

    async tryOfficeAuth(shareUrl) {
        // This is an experimental approach using Office.js authentication context
        try {
            console.log('Trying Office.js authentication context...');
            
            // Get an access token from Office.js (if supported)
            const token = await new Promise((resolve, reject) => {
                Office.context.auth.getAccessToken({ allowSignInPrompt: true }, (result) => {
                    if (result.status === Office.AsyncResultStatus.Succeeded) {
                        resolve(result.value);
                    } else {
                        reject(new Error(result.error.message));
                    }
                });
            });
            
            if (token) {
                console.log('Got Office.js token, trying authenticated request...');
                const response = await fetch(shareUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json, text/plain, */*'
                    }
                });
                
                if (response.ok) {
                    const configData = await response.json();
                    this.configManager.setConfig(configData);
                    await this.reloadMappingModules();
                    state.setStatus("OneDrive configuration loaded successfully");
                    return true;
                }
            }
        } catch (error) {
            console.log('Office.js auth approach failed:', error.message);
        }
        
        return false; // Failed
    }

    getAllUrlAttempts(shareUrl) {
        const attempts = [];
        
        if (shareUrl.includes('1drv.ms')) {
            try {
                const urlObj = new URL(shareUrl);
                const pathParts = urlObj.pathname.split('/').filter(part => part);
                
                if (pathParts.length >= 3) {
                    const cid = pathParts[2];
                    const itemPath = pathParts.slice(3).join('/');
                    const authKey = urlObj.searchParams.get('e');
                    
                    // Multiple URL format attempts (ordered by likelihood of success)
                    attempts.push(
                        // Try the original URL first (may work directly with session auth)
                        shareUrl,
                        
                        // Simple download parameter addition
                        shareUrl + '&download=1',
                        
                        // Convert 1drv.ms to onedrive.live.com with download
                        shareUrl.replace('1drv.ms', 'onedrive.live.com') + '&download=1',
                        
                        // Remove the 'e' parameter and add download (sometimes needed)
                        shareUrl.split('?')[0] + '?download=1',
                        
                        // Try with different download formats
                        shareUrl.replace('?e=', '&download=1&e='),
                        
                        // Direct onedrive.live.com download format
                        `https://onedrive.live.com/download?cid=${cid}&resid=${cid}%21${itemPath}&authkey=${authKey || ''}`,
                        
                        // Alternative with encoded resid
                        `https://onedrive.live.com/download?cid=${cid}&resid=${cid}!${itemPath.replace(/[^a-zA-Z0-9]/g, '')}&authkey=${authKey || ''}`
                    );
                }
            } catch (error) {
                console.error('URL parsing error:', error);
            }
        }
        
        // If no specific attempts or as fallback, add basic attempts
        if (attempts.length === 0) {
            attempts.push(
                shareUrl + (shareUrl.includes('?') ? '&' : '?') + 'download=1',
                shareUrl
            );
        }
        
        return attempts;
    }

    convertToDirectUrl(shareUrl) {
        // This method is now deprecated in favor of getAllUrlAttempts()
        // but kept for compatibility
        const attempts = this.getAllUrlAttempts(shareUrl);
        return attempts[0] || shareUrl;
    }

    updateStatus(message, isError = false) {
        const statusElement = document.getElementById('main-status-message');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.style.color = isError ? '#D83B01' : '';
        }
    }

    // Public API
    getAllLoadedMappings() { return this.loadedMappings; }
    getMappingModules() { return this.mappingModules; }
}