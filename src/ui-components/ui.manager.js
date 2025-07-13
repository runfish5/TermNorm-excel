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
            }
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
        this.updateCombinedMetadata();
    }

    updateCombinedMetadata() {
        if (this.loadedMappings.size === 0) return this.metadataDisplay.hide();

        const sources = Array.from(this.loadedMappings.entries()).map(([index, { mappings, result }]) => {
            const forward = Object.keys(mappings.forward).length;
            const reverse = Object.keys(mappings.reverse).length;
            return { index: index + 1, forward, reverse, issues: result.metadata?.issues?.length || 0 };
        });

        this.metadataDisplay.show({
            summary: `${this.loadedMappings.size} mapping source(s) loaded`,
            totalMappings: sources.reduce((sum, s) => sum + s.forward, 0),
            totalIssues: sources.reduce((sum, s) => sum + s.issues, 0),
            sources
        });
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