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
            
            // Convert sharing URL to direct API access URL if needed
            const directUrl = this.convertToDirectUrl(url);
            console.log('Original URL:', url);
            console.log('Converted URL:', directUrl);
            
            const response = await fetch(directUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json, text/plain, */*'
                }
            });
            
            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}`;
                if (response.status === 404) {
                    errorMessage = "File not found or not publicly accessible";
                } else if (response.status === 403) {
                    errorMessage = "Access denied - check file sharing permissions";
                } else if (response.status === 0 || response.status === 502) {
                    errorMessage = "CORS error - file may need different sharing settings";
                }
                throw new Error(errorMessage);
            }
            
            let configData;
            const contentType = response.headers.get('content-type');
            
            if (contentType && contentType.includes('application/json')) {
                configData = await response.json();
            } else {
                // Try to parse as text first, then as JSON
                const textData = await response.text();
                try {
                    configData = JSON.parse(textData);
                } catch (parseError) {
                    throw new Error("File is not valid JSON format");
                }
            }
            
            // Validate that we got a valid config object
            if (!configData || typeof configData !== 'object') {
                throw new Error("Invalid configuration format");
            }
            
            // Process the loaded config similar to local configs
            this.configManager.setConfig(configData);
            await this.reloadMappingModules();
            
            state.setStatus("OneDrive configuration loaded successfully");
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

    convertToDirectUrl(shareUrl) {
        try {
            // Handle different OneDrive URL formats
            if (shareUrl.includes('1drv.ms')) {
                // Modern 1drv.ms format: https://1drv.ms/x/c/fileId/itemPath?e=hash
                const urlObj = new URL(shareUrl);
                const pathParts = urlObj.pathname.split('/');
                
                if (pathParts.length >= 4) {
                    const fileId = pathParts[3]; // Extract file ID from path
                    const itemPath = pathParts.slice(4).join('/');
                    
                    // Convert to direct download URL using OneDrive public API
                    return `https://api.onedrive.com/v1.0/shares/u!${btoa(shareUrl).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}/root/content`;
                }
            } else if (shareUrl.includes('sharepoint.com') || shareUrl.includes('my.sharepoint.com')) {
                // SharePoint format - convert to download URL
                const downloadUrl = shareUrl.replace(/\?.*$/, '') + '?download=1';
                return downloadUrl;
            }
            
            // Fallback: try appending download parameter
            const separator = shareUrl.includes('?') ? '&' : '?';
            return shareUrl + separator + 'download=1';
            
        } catch (error) {
            console.error('URL conversion error:', error);
            // Return original URL as fallback
            return shareUrl;
        }
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