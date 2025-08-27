// shared-services/app.orchestrator.js
import { ConfigManager } from './config.manager.js';
import { LiveTracker } from '../services/normalizer.main.js';
import { aiPromptRenewer } from '../services/aiPromptRenewer.js';
import { UIManager } from '../ui-components/ui.manager.js';
import { state } from './state.manager.js';
import { EnvironmentDetector } from './environment.detector.js';
import { CloudConfigSelector } from '../ui-components/cloud-config-selector.js';

export class AppOrchestrator {
    constructor() {
        this.configManager = new ConfigManager();
        this.tracker = new LiveTracker();
        this.ui = new UIManager();
        this.aiPromptRenewer = new aiPromptRenewer((msg, isError) => state.setStatus(msg, isError));
        this.configLoaded = false;
        this.cloudConfigSelector = new CloudConfigSelector();
        this.environmentInfo = null;
        
        // Add this line for easy debugging
        window.state = state;
    }

    async init() {
        // Get environment information
        this.environmentInfo = EnvironmentDetector.getEnvironmentInfo();
        console.log('Environment detected:', this.environmentInfo);
        
        // Set environment icon
        this.setEnvironmentIcon();
        
        this.ui.init();
        this.setupEvents();
        
        // Two-stage initialization for cloud environments
        await this.initializeConfiguration();
        this.configLoaded = true;
    }

    async initializeConfiguration() {
        try {
            // Stage 1: Determine config source
            let configSource = null;
            
            if (this.environmentInfo.requiresCloudConfig) {
                state.setStatus('Excel Online detected - Select configuration file location...');
                
                try {
                    configSource = await this.cloudConfigSelector.show();
                    console.log('Config source selected:', configSource);
                } catch (error) {
                    if (error.message === 'Config selection cancelled') {
                        state.setStatus('Configuration selection cancelled', true);
                        return;
                    }
                    throw error;
                }
            }
            
            // Stage 2: Load configuration
            await this.reloadConfig(configSource);
            
        } catch (error) {
            console.error('Configuration initialization failed:', error);
            state.setStatus(`Config initialization failed: ${error.message}`, true);
        }
    }

    setupEvents() {
        // Existing events
        document.getElementById('renew-prompt')?.addEventListener('click', () => this.renewPrompt());
        document.getElementById('load-config')?.addEventListener('click', e => {
            e.preventDefault();
            this.ui.showView('config');
            if (!this.configLoaded) this.reloadConfig();
        });
    }

    async reloadConfig(configSource = null) {
        try {
            await this.configManager.loadConfig(configSource);
            // Store config in state for direct UI access
            const config = this.configManager.getConfig();
            state.setConfig(config);
            
            if (!this.configLoaded) await this.ui.reloadMappingModules();

            const sourceMsg = configSource ? 
                `Config loaded from ${configSource.type === 'cloud' ? 'cloud URL' : 'local file'}` : 
                "Config reloaded";
            state.setStatus(sourceMsg);
        } catch (error) {
            let errorMessage = `Config failed: ${error.message}`;
            
            if (!configSource && !this.environmentInfo?.requiresCloudConfig) {
                errorMessage += `\n\nPlease create config at:\nC:\\Users\\{YOURS}\\OfficeAddinApps\\TermNorm-excel\\config\\app.config.json \n\nFor Help go to:\nhttps://github.com/runfish5/TermNorm-excel`;
            } else if (this.environmentInfo?.requiresCloudConfig) {
                errorMessage += `\n\nFor Excel Online:\n1. Upload your app.config.json to SharePoint/OneDrive\n2. Use "Load Config" button to specify the file location\n3. Ensure the backend API supports cloud file access`;
            }
            
            state.setStatus(errorMessage, true);
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

    setEnvironmentIcon() {
        const iconElement = document.getElementById('environment-icon');
        if (!iconElement) return;
        
        if (this.environmentInfo.isOnline) {
            iconElement.textContent = '🌐';
            iconElement.title = 'Excel Online (Cloud Environment)';
        } else if (this.environmentInfo.isDesktop) {
            iconElement.textContent = '💻';
            iconElement.title = 'Excel Desktop (Local Environment)';
        } else {
            iconElement.textContent = '❓';
            iconElement.title = 'Unknown Environment';
        }
    }

}