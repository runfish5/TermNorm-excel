// ui-components/ui.manager.js
import { MetadataDisplay } from './metadata.display.js';
import { MappingConfigModule } from './mapping-config-module.js';
import { CandidateRankingUI } from './CandidateRankingUI.js';
import { state } from '../shared-services/state.manager.js';
// Direct imports - no more orchestrator dependency
import { LiveTracker } from '../services/normalizer.handler.js';
import { ConfigManager } from '../shared-services/config.manager.js';

export class UIManager {
    constructor() {
        this.metadataDisplay = new MetadataDisplay();
        this.mappingModules = [];
        this.loadedMappings = new Map(); // Store mappings from each module
        // Direct service instances
        this.tracker = new LiveTracker();
        this.configManager = new ConfigManager();
    }

    init() {
        this.metadataDisplay.init();
        this.setupEvents();
        CandidateRankingUI.init();
        this.showView('config');
        // Simple status subscription
        state.subscribe('ui', (ui) => {
            this.updateStatus(ui.statusMessage, ui.isError);
        });
        return this;
    }

    setupEvents() {
        // Global metadata toggle
        document.getElementById('show-metadata-btn')?.addEventListener('click', () => {
            const content = document.getElementById('metadata-content');
            const isHidden = content?.classList.toggle('hidden');
            const label = document.querySelector('#show-metadata-btn .ms-Button-label');
            if (label) label.textContent = isHidden ? 'Show Processing Details' : 'Hide Processing Details';
        });

        // Global load all mappings button
        document.getElementById('load-all-mappings')?.addEventListener('click', () => {
            this.loadAllMappings();
        });

        // Direct tracking setup - no more event dispatching
        document.getElementById('setup-map-tracking')?.addEventListener('click', () => {
            this.setupTracking();
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
        if (!config || !config.standard_mappings) return;

        // Clear existing modules
        this.clearMappingModules();

        // Create mapping modules for each standard mapping
        const container = document.getElementById('mapping-configs-container');
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

    clearMappingModules() {
        const container = document.getElementById('mapping-configs-container');
        if (container) {
            container.innerHTML = '';
        }
        this.mappingModules = [];
        this.loadedMappings.clear();
    }

    onMappingLoaded(moduleIndex, mappings, result) {
        this.loadedMappings.set(moduleIndex, { mappings, result });
        this.updateGlobalStatus();
        // Update global metadata display with combined info
        this.updateCombinedMetadata();
    }

    updateCombinedMetadata() {
        if (this.loadedMappings.size === 0) {
            this.metadataDisplay.hide();
            return;
        }

        // Combine metadata from all loaded mappings
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
        const promises = this.mappingModules.map(module => {
            return module.loadMappings().catch(error => {
                console.error(`Error loading mapping ${module.index}:`, error);
                return null;
            });
        });

        try {
            await Promise.all(promises);
            this.updateGlobalStatus();
        } catch (error) {
            state.setStatus(`Error loading mappings: ${error.message}`, true);
        }
    }

    // Direct tracking setup - no more orchestrator dependency
    async setupTracking() {
        // Get config directly from state
        const config = state.get('config.data');
        if (!config?.column_map || !Object.keys(config.column_map).length) {
            state.setStatus("Error: Load config first", true);
            return;
        }

        // Combine all loaded mappings for tracking
        const combinedMappings = {
            forward: {},
            reverse: {},
            metadata: { sources: [] }
        };

        this.loadedMappings.forEach((data, index) => {
            const { mappings, result } = data;
            // Merge forward mappings
            Object.assign(combinedMappings.forward, mappings.forward);
            // Merge reverse mappings
            Object.assign(combinedMappings.reverse, mappings.reverse);
            // Add source info to metadata
            combinedMappings.metadata.sources.push({
                index: index + 1,
                config: this.mappingModules[index].getConfig(),
                mappings: mappings,
                metadata: result.metadata
            });
        });

        // Update global state with combined mappings
        state.setMappings(combinedMappings.forward, combinedMappings.reverse, combinedMappings.metadata);

        // Get mappings from state
        const mappings = state.get('mappings');
        const hasForward = mappings.forward && Object.keys(mappings.forward).length > 0;
        const hasReverse = mappings.reverse && Object.keys(mappings.reverse).length > 0;

        if (!hasForward && !hasReverse) {
            state.setStatus("Error: Load mappings first", true);
            return;
        }

        try {
            // Direct tracking start - no orchestrator
            await this.tracker.start(config, mappings);
            
            // Calculate tracking mode info
            const forwardCount = Object.keys(mappings.forward || {}).length;
            const reverseCount = Object.keys(mappings.reverse || {}).length;
            const sourcesCount = mappings.metadata?.sources?.length || 0;
            
            let mode = hasForward ? "with mappings" : "reverse-only";
            if (sourcesCount > 1) {
                mode += ` (${sourcesCount} sources)`;
            }
            
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

    status(message, isError = false) {
        state.setStatus(message, isError);
    }

    // Keep for backward compatibility with existing code
    handleMappingSuccess(result, mappings) {
        this.updateCombinedMetadata();
    }

    handleMappingError(error, mappings) {
        state.setStatus(error.message, true);
    }

    getAllLoadedMappings() {
        return this.loadedMappings;
    }

    getMappingModules() {
        return this.mappingModules;
    }
}