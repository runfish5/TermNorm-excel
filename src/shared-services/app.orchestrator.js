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
        await this.reloadConfig();
    }

    setupEvents() {
        const actions = {
            'load-mapping': () => this.loadMappings(),
            'renew-prompt': () => this.renewPrompt(),
            'setup-map-tracking': () => this.startTracking(),
            'load-config': (e) => { e.preventDefault(); this.ui.showConfigDiv(); this.reloadConfig(); },
            'activate-tracking': (e) => { e.preventDefault(); this.ui.showTrackingDiv(); this.startTracking(); }
        };

        Object.entries(actions).forEach(([id, handler]) => {
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
            const result = await loadAndProcessMappings(this.ui.getMappingParams());
            
            // Update mappings
            Object.assign(this.mappings, {
                forward: result.forward || {},
                reverse: result.reverse || {},
                metadata: result.metadata || null
            });
            
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
        
        let cancelled = false;
        const cancelHandler = () => {
            cancelled = true;
            this.ui.status("Generation cancelled", false, "prompt-status");
        };
        
        // Switch to cancel mode
        if (btn) {
            btn.removeEventListener('click', this.renewPrompt);
            btn.addEventListener('click', cancelHandler);
        }
        if (label) label.textContent = 'Cancel Generation';
        
        try {
            await this.aiPromptRenewer.renewPrompt(this.mappings, config, () => cancelled);
        } finally {
            // Restore normal state
            if (btn) {
                btn.removeEventListener('click', cancelHandler);
                btn.addEventListener('click', () => this.renewPrompt());
            }
            if (label) label.textContent = originalText;
        }
    }

    async startTracking() {
        const config = this.configManager.getConfig();
        
        // Quick validation
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