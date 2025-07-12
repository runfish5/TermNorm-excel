// shared-services/app.orchestrator.js
import { ConfigManager } from './config.manager.js';
import { LiveTracker } from '../services/normalizer.handler.js';
import { aiPromptRenewer } from '../services/aiPromptRenewer.js';
import { UIManager } from '../ui-components/ui.manager.js';
import { state } from './state.manager.js';

export class AppOrchestrator {
    constructor() {
        this.configManager = new ConfigManager();
        this.tracker = new LiveTracker();
        this.ui = new UIManager();
        this.aiPromptRenewer = new aiPromptRenewer((msg, isError) => state.setStatus(msg, isError));
        this.configLoaded = false;
    }

    async init() {
        this.ui.init();
        this.setupEvents();
        await this.reloadConfig();
        this.configLoaded = true;
    }

    setupEvents() {
        // Existing events
        document.getElementById('renew-prompt')?.addEventListener('click', () => this.renewPrompt());
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

        // Removed: window.addEventListener('start-tracking') - UI handles tracking directly now

        // Update configs count display
        state.subscribe('config', (config) => {
            this.updateConfigsCount();
        });
    }

    async reloadConfig() {
        try {
            await this.configManager.loadConfig();
            // Store config in state for direct UI access
            const config = this.configManager.getConfig();
            state.setConfig(config);
            
            if (!this.configLoaded) this.ui.updateFromConfig(this.configManager);
            this.updateConfigsCount();
            state.setStatus("Config reloaded");
        } catch (error) {
            state.setStatus(`Config failed: ${error.message}`, true);
        }
    }

    updateConfigsCount() {
        const config = this.configManager.getConfig();
        const countElement = document.getElementById('configs-count');
        if (countElement && config) {
            const count = this.configManager.getStandardMappingsCount();
            countElement.textContent = `${count} mapping configuration${count !== 1 ? 's' : ''} loaded`;
        }
    }

    async renewPrompt() {
        const config = this.configManager.getConfig();
        if (!config) {
            state.setStatus("Config not loaded", true);
            return;
        }

        const button = document.getElementById('renew-prompt');
        const label = button?.querySelector('.ms-Button-label');
        const originalText = label?.textContent || 'Renew Prompt 🤖';
        let cancelled = false;

        const cancelHandler = () => {
            cancelled = true;
            state.setStatus("Generation cancelled");
        };

        if (button) {
            button.removeEventListener('click', this.renewPrompt);
            button.addEventListener('click', cancelHandler);
        }
        if (label) label.textContent = 'Cancel Generation';

        try {
            const mappings = state.get('mappings');
            await this.aiPromptRenewer.renewPrompt(mappings, config, () => cancelled);
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
            state.setStatus("Error: Load config first", true);
            return;
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
            // Calculate tracking mode info
            const forwardCount = Object.keys(mappings.forward || {}).length;
            const reverseCount = Object.keys(mappings.reverse || {}).length;
            const sourcesCount = mappings.metadata?.sources?.length || 0;
            
            let mode = hasForward ? "with mappings" : "reverse-only";
            if (sourcesCount > 1) {
                mode += ` (${sourcesCount} sources)`;
            }
            
            state.setStatus(`Tracking active ${mode} - ${forwardCount} forward, ${reverseCount} reverse`);
            this.ui.showView('tracking');
        } catch (error) {
            state.setStatus(`Error: ${error.message}`, true);
        }
    }

    // Helper methods for debugging and monitoring
    getConfigSummary() {
        return this.configManager.getConfigSummary();
    }

    getAllLoadedMappings() {
        return this.ui.getAllLoadedMappings();
    }

    getMappingModules() {
        return this.ui.getMappingModules();
    }

    // Validation helper
    validateReadyForTracking() {
        const config = this.configManager.getConfig();
        const mappings = state.get('mappings');
        const issues = [];

        if (!config) {
            issues.push("Configuration not loaded");
        } else {
            if (!config.column_map || Object.keys(config.column_map).length === 0) {
                issues.push("No column mapping configured");
            }
            if (!config.standard_mappings || config.standard_mappings.length === 0) {
                issues.push("No standard mappings configured");
            }
        }

        if (!mappings || (!mappings.forward && !mappings.reverse)) {
            issues.push("No mapping data loaded");
        } else {
            const forwardCount = Object.keys(mappings.forward || {}).length;
            const reverseCount = Object.keys(mappings.reverse || {}).length;
            if (forwardCount === 0 && reverseCount === 0) {
                issues.push("No mapping entries found");
            }
        }

        return {
            ready: issues.length === 0,
            issues
        };
    }
}