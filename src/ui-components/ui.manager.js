// ui-components/ui.manager.js
import { MetadataDisplay } from './metadata.display.js';
import { MappingConfigModule } from './mapping-config-module.js';
import { CandidateRankingUI } from './CandidateRankingUI.js';
import { state } from '../shared-services/state.manager.js';
import { LiveTracker } from '../services/normalizer.handler.js';
import { ConfigManager } from '../shared-services/config.manager.js';

export class UIManager {
    constructor() {
        this.metadataDisplay = new MetadataDisplay();
        this.mappingModules = [];
        this.loadedMappings = new Map();
        this.tracker = new LiveTracker();
        this.configManager = new ConfigManager();
    }

    init() {
        this.metadataDisplay.init();
        this.setupEvents();
        CandidateRankingUI.init();
        this.showView('config');
        
        state.subscribe('ui', (ui) => {
            this.updateStatus(ui.statusMessage, ui.isError);
        });
        return this;
    }

    setupEvents() {
        // Metadata toggle
        document.getElementById('show-metadata-btn')?.addEventListener('click', () => {
            const content = document.getElementById('metadata-content');
            const isHidden = content?.classList.toggle('hidden');
            const label = document.querySelector('#show-metadata-btn .ms-Button-label');
            if (label) label.textContent = isHidden ? 'Show Processing Details' : 'Hide Processing Details';
        });

        // Load all mappings
        document.getElementById('load-all-mappings')?.addEventListener('click', () => {
            this.loadAllMappings();
        });

        // Both tracking buttons do the same thing now
        const startTracking = () => this.startTracking();
        document.getElementById('setup-map-tracking')?.addEventListener('click', startTracking);
        document.getElementById('activate-tracking')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showView('tracking');
            startTracking();
        });
    }

    showView(viewName) {
        document.getElementById('config-div')?.classList.toggle('hidden', viewName !== 'config');
        document.getElementById('tracking-div')?.classList.toggle('hidden', viewName !== 'tracking');
        document.getElementById('load-config')?.classList.toggle('ms-Button--primary', viewName === 'config');
        document.getElementById('activate-tracking')?.classList.toggle('ms-Button--primary', viewName === 'tracking');
        state.setView(viewName);
    }

    updateFromConfig(configManager) {
        const config = configManager.getConfig();
        if (!config?.standard_mappings) return;

        // Clear existing modules
        const container = document.getElementById('mapping-configs-container');
        if (container) container.innerHTML = '';
        this.mappingModules = [];
        this.loadedMappings.clear();

        if (!container) {
            console.error('Mapping configs container not found');
            return;
        }

        config.standard_mappings.forEach((mappingConfig, index) => {
            const module = new MappingConfigModule(
                mappingConfig, 
                index, 
                (moduleIndex, mappings, result) => this.onMappingLoaded(moduleIndex, mappings, result)
            );
            module.init(container);
            this.mappingModules.push(module);
        });

        this.updateGlobalStatus();
    }



    onMappingLoaded(moduleIndex, mappings, result) {
        this.loadedMappings.set(moduleIndex, { mappings, result });
        this.updateGlobalStatus();
        this.updateCombinedMetadata();
    }

    updateCombinedMetadata() {
        if (this.loadedMappings.size === 0) {
            this.metadataDisplay.hide();
            return;
        }

        const combinedMetadata = {
            summary: `${this.loadedMappings.size} mapping source(s) loaded`,
            totalMappings: 0,
            totalIssues: 0,
            sources: []
        };

        this.loadedMappings.forEach((data, index) => {
            const { mappings, result } = data;
            const forward = Object.keys(mappings.forward).length;
            const reverse = Object.keys(mappings.reverse).length;
            
            combinedMetadata.totalMappings += forward;
            if (result.metadata?.issues) {
                combinedMetadata.totalIssues += result.metadata.issues.length;
            }
            combinedMetadata.sources.push({
                index: index + 1,
                forward,
                reverse,
                issues: result.metadata?.issues?.length || 0
            });
        });

        this.metadataDisplay.show(combinedMetadata);
    }

    updateGlobalStatus() {
        const totalLoaded = this.loadedMappings.size;
        const totalModules = this.mappingModules.length;
        
        if (totalLoaded === 0) {
            state.setStatus("Ready to load mapping configurations...");
        } else if (totalLoaded === totalModules) {
            const totalMappings = Array.from(this.loadedMappings.values())
                .reduce((sum, data) => sum + Object.keys(data.mappings.forward).length, 0);
            state.setStatus(`All ${totalModules} mapping sources loaded (${totalMappings} total mappings)`);
        } else {
            state.setStatus(`${totalLoaded}/${totalModules} mapping sources loaded`);
        }
    }

    async loadAllMappings() {
        if (this.mappingModules.length === 0) {
            state.setStatus("No mapping configurations available", true);
            return;
        }

        state.setStatus("Loading all mappings...");
        const promises = this.mappingModules.map(module => 
            module.loadMappings().catch(error => {
                console.error(`Error loading mapping ${module.index}:`, error);
                return null;
            })
        );

        try {
            await Promise.all(promises);
            this.updateGlobalStatus();
        } catch (error) {
            state.setStatus(`Error loading mappings: ${error.message}`, true);
        }
    }

    async startTracking() {
        // Quick validation
        const config = state.get('config.data');
        if (!config?.column_map || !Object.keys(config.column_map).length) {
            state.setStatus("Error: Load config first", true);
            return;
        }

        // Combine mappings if needed
        if (this.loadedMappings.size > 0) {
            const combined = { forward: {}, reverse: {}, metadata: { sources: [] } };
            
            this.loadedMappings.forEach((data, index) => {
                Object.assign(combined.forward, data.mappings.forward);
                Object.assign(combined.reverse, data.mappings.reverse);
                combined.metadata.sources.push({
                    index: index + 1,
                    config: this.mappingModules[index].getConfig(),
                    mappings: data.mappings,
                    metadata: data.result.metadata
                });
            });
            
            state.setMappings(combined.forward, combined.reverse, combined.metadata);
        }

        const mappings = state.get('mappings');
        const hasForward = mappings.forward && Object.keys(mappings.forward).length > 0;
        const hasReverse = mappings.reverse && Object.keys(mappings.reverse).length > 0;

        if (!hasForward && !hasReverse) {
            state.setStatus("Error: Load mappings first", true);
            return;
        }

        try {
            await this.tracker.start(config, mappings);
            
            // Status message
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

    updateStatus(message, isError = false) {
        const statusElement = document.getElementById('main-status-message');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.style.color = isError ? '#D83B01' : '';
        }
    }

    // Public API
    getAllLoadedMappings() {
        return this.loadedMappings;
    }

    getMappingModules() {
        return this.mappingModules;
    }
}