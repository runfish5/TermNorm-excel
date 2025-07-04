// ./shared-services/app.orchestrator.js
import { ConfigManager } from './config.manager.js';
import { loadAndProcessMappings } from '../data-processing/mapping.processor.js';
import { LiveTracker } from '../services/normalizer.handler.js';
import { aiPromptRenewer } from '../services/aiPromptRenewer.js';
import { UIManager } from '../ui-components/ui.manager.js';

export class AppOrchestrator {
    constructor() {
        this.configManager = new ConfigManager();
        this.mappings = { forward: {}, reverse: {}, metadata: null };
        this.tracker = new LiveTracker();
        this.ui = new UIManager();
        this.aiPromptRenewer = new aiPromptRenewer((msg, isError, id) => this.ui.status(msg, isError, id));
    }

    async init() {
        this.ui.init();
        await this.configManager.loadConfig();
        this.ui.updateFromConfig(this.configManager);
        this.setupEvents();

        const config = this.configManager.getConfig();
        const totalMappings = Object.keys(config.column_map || {}).length + Object.keys(config.reverse_column_map || {}).length;
        this.ui.status(`Config loaded. ${totalMappings} mappings configured.`);
    }

    setupEvents() {
        const handlers = {
            'load-config': () => this.reloadConfig(),
            'load-mapping': () => this.loadMappings(),
            'renew-prompt': () => this.renewPrompt(),
            'setup-map-tracking': () => this.startTracking()
        };

        Object.entries(handlers).forEach(([id, handler]) => {
            document.getElementById(id)?.addEventListener('click', handler);
        });

        window.addEventListener('external-file-loaded', () => {
            this.ui.selectWorksheet(this.configManager.getWorksheet());
        });
    }

    async reloadConfig() {
        try {
            await this.configManager.loadConfig();
            this.ui.updateFromConfig(this.configManager);
            this.ui.status("Config reloaded", false, "config-status");
        } catch (error) {
            this.ui.status(`Config failed: ${error.message}`, true, "config-status");
        }
    }

    async loadMappings() {
        try {
            this.ui.status("Loading...");
            const params = this.ui.getMappingParams();
            const result = await loadAndProcessMappings(params);
            
            this.mappings.forward = result.forward || {};
            this.mappings.reverse = result.reverse || {};
            this.mappings.metadata = result.metadata || null;
            
            this.ui.handleMappingSuccess(result, this.mappings);
        } catch (error) {
            this.ui.handleMappingError(error, this.mappings);
        }
    }

    async renewPrompt() {
        const config = this.configManager.getConfig();
        if (!config) {
            this.ui.status("Config not loaded", true, "prompt-status");
            return;
        }
        await this.aiPromptRenewer.renewPrompt(this.mappings, config);
    }

    async startTracking() {
        try {
            const config = this.configManager.getConfig();
            
            if (!config?.column_map || !Object.keys(config.column_map).length) {
                throw new Error("Load config first");
            }
            
            if (!Object.keys(this.mappings.forward).length && !Object.keys(this.mappings.reverse).length) {
                throw new Error("Load mappings first");
            }

            await this.tracker.start(config, this.mappings);
            
            const mode = Object.keys(this.mappings.forward).length ? "with mappings" : "reverse-only";
            this.ui.status(`Tracking active (${mode})`, false, "item-subject");
        } catch (error) {
            this.ui.status(`Error: ${error.message}`, true, "item-subject");
        }
    }

    stopTracking() { this.tracker.stop(); }
    isTrackingActive() { return this.tracker.active; }
}