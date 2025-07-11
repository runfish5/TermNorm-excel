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
        this.configLoaded = false;
    }

    async init() {
        this.ui.init();
        this.setupEvents();
        await this.reloadConfig();
        this.configLoaded = true;
    }

    setupEvents() {
        document.getElementById('load-mapping')?.addEventListener('click', () => this.loadMappings());
        document.getElementById('renew-prompt')?.addEventListener('click', () => this.renewPrompt());
        document.getElementById('setup-map-tracking')?.addEventListener('click', () => this.startTracking());
        document.getElementById('load-config')?.addEventListener('click', e => {
            e.preventDefault();
            this.ui.showView('config');
            if (!this.configLoaded) this.reloadConfig();
        });
        document.getElementById('activate-tracking')?.addEventListener('click', e => {
            e.preventDefault();
            this.ui.showView('tracking');
            this.startTracking();
        });

        window.addEventListener('external-file-loaded', () => {
            this.ui.selectWorksheet(this.configManager.getWorksheet());
        });
    }

    async reloadConfig() {
        try {
            await this.configManager.loadConfig();
            if (!this.configLoaded) this.ui.updateFromConfig(this.configManager);
            this.ui.status("Config reloaded", false, "config-status");
        } catch (error) {
            this.ui.status(`Config failed: ${error.message}`, true, "config-status");
        }
    }

    async loadMappings() {
        try {
            this.ui.status("Loading...");
            
            const customParams = {
                useCurrentFile: document.getElementById('current-file')?.checked || false,
                sheetName: document.getElementById('worksheet-dropdown')?.value || '',
                sourceColumn: document.getElementById('source-column')?.value || null,
                targetColumn: document.getElementById('target-column')?.value || '',
                externalFile: this.ui.externalFile
            };
            
            const result = await loadAndProcessMappings(customParams);
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
        
        const button = document.getElementById('renew-prompt');
        const label = button?.querySelector('.ms-Button-label');
        const originalText = label?.textContent || 'Renew Prompt 🤖';
        
        let cancelled = false;
        const cancelHandler = () => {
            cancelled = true;
            this.ui.status("Generation cancelled", false, "prompt-status");
        };
        
        if (button) {
            button.removeEventListener('click', this.renewPrompt);
            button.addEventListener('click', cancelHandler);
        }
        if (label) label.textContent = 'Cancel Generation';
        
        try {
            await this.aiPromptRenewer.renewPrompt(this.mappings, config, () => cancelled);
        } finally {
            if (button) {
                button.removeEventListener('click', cancelHandler);
                button.addEventListener('click', () => this.renewPrompt());
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
            this.ui.showView('tracking');
        } catch (error) {
            this.ui.status(`Error: ${error.message}`);
        }
    }
}