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
        this.setupEvents();
        
        await this.configManager.loadConfig();
        this.ui.updateFromConfig(this.configManager);
    }

    setupEvents() {
        document.getElementById('load-mapping').addEventListener('click', () => this.loadMappings());
        document.getElementById('renew-prompt').addEventListener('click', () => this.renewPrompt());
        document.getElementById('setup-map-tracking').addEventListener('click', () => this.startTracking());
        
        // Navigation event handlers
        document.getElementById('load-config').addEventListener('click', (e) => {
            e.preventDefault();
            this.ui.showConfigDiv();
            this.reloadConfig();
        });
        
        document.getElementById('activate-tracking').addEventListener('click', (e) => {
            e.preventDefault();
            this.ui.showTrackingDiv();
            this.startTracking();
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
        
        const btn = document.getElementById('renew-prompt');
        const label = btn?.querySelector('.ms-Button-label');
        const originalText = label?.textContent || 'Renew Prompt 🤖';
        
        // Set up cancellation
        let cancelled = false;
        const cancelHandler = () => {
            cancelled = true;
            this.ui.status("Generation cancelled", false, "prompt-status");
        };
        
        if (btn) {
            btn.disabled = false;
            btn.removeEventListener('click', this.renewPrompt);
            btn.addEventListener('click', cancelHandler);
        }
        if (label) label.textContent = 'Cancel Generation';
        
        try {
            await this.aiPromptRenewer.renewPrompt(this.mappings, config, () => cancelled);
        } finally {
            // Reset button
            if (btn) {
                btn.removeEventListener('click', cancelHandler);
                btn.addEventListener('click', () => this.renewPrompt());
                btn.disabled = false;
            }
            if (label) label.textContent = originalText;
        }
    }

    async startTracking() {
        const config = this.configManager.getConfig();
        
        if (!config?.column_map || !Object.keys(config.column_map).length) {
            this.ui.status("Error: Load config first");
            return;
        }
        
        const hasForward = Object.keys(this.mappings.forward).length > 0;
        const hasReverse = Object.keys(this.mappings.reverse).length > 0;
        
        if (!hasForward && !hasReverse) {
            this.ui.status("Error: Load mappings first");
            return;
        }
        
        try {
            await this.tracker.start(config, this.mappings);
            const mode = hasForward ? "with mappings" : "reverse-only";
            this.ui.status(`Tracking active (${mode})`);
            this.ui.showTrackingDiv();
        } catch (error) {
            this.ui.status(`Error: ${error.message}`);
        }
    }
}