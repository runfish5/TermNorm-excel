// ui-components/ui.manager.js
import { MetadataDisplay } from './metadata.display.js';
import { ExcelIntegration } from '../services/excel-integration.js';
import { CandidateRankingUI } from './CandidateRankingUI.js';

export class UIManager {
    constructor(orchestrator = null) {
        this.metadataDisplay = new MetadataDisplay();
        this.excelIntegration = new ExcelIntegration();
        this.externalFile = null;
        this.orchestrator = orchestrator; // Reference to orchestrator for triggering actions
    }

    init() {
        this.metadataDisplay.init();
        this.setupEvents();
        this.setupNavigationEvents();
        this.loadCurrentSheets();
        CandidateRankingUI.init();
        this.showConfigDiv(); // Initialize with config view
        return this;
    }

    setupEvents() {
        // File source events
        document.getElementById('current-file')?.addEventListener('change', () => {
            document.getElementById('external-file-section').style.display = 'none';
            this.loadCurrentSheets();
        });

        document.getElementById('external-file')?.addEventListener('change', () => {
            document.getElementById('external-file-section').style.display = 'block';
            this.externalFile ? this.loadExternalSheets() : this.setDropdown(['Select external file first...'], true);
        });

        // File picker events
        document.getElementById('browse-button')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('file-picker-input')?.click();
        });

        document.getElementById('file-picker-input')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.externalFile = file;
                document.getElementById('file-path-display').value = file.name;
                this.status(`Reading ${file.name}...`);
                this.loadExternalSheets();
            }
        });

        // Activity toggle functionality
        const historyRadio = document.getElementById('activity-history');
        const rankedRadio = document.getElementById('activity-ranked');
        const activityFeed = document.getElementById('activity-feed');
        const candidateRanked = document.getElementById('candidate-ranked');
        
        const toggleActivityView = () => {
            if (historyRadio?.checked) {
                if (activityFeed) activityFeed.style.display = 'block';
                if (candidateRanked) candidateRanked.style.display = 'none';
            } else {
                if (activityFeed) activityFeed.style.display = 'none';
                if (candidateRanked) candidateRanked.style.display = 'block';
            }
        };

        historyRadio?.addEventListener('change', toggleActivityView);
        rankedRadio?.addEventListener('change', toggleActivityView);
        
        this.setupMetadataToggle();
    }

    setupNavigationEvents() {
        const loadConfigBtn = document.getElementById('load-config');
        const activateTrackingBtn = document.getElementById('activate-tracking');

        // Only handle navigation, not functionality
        loadConfigBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showConfigDiv();
        });
        
        activateTrackingBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showTrackingDiv();
        });

        // External file radio button events
        document.getElementById('external-file')?.addEventListener('change', (e) => {
            const externalFileSection = document.getElementById('external-file-section');
            if (e.target.checked) {
                externalFileSection?.classList.remove('hidden');
            } else {
                externalFileSection?.classList.add('hidden');
            }
        });

        document.getElementById('current-file')?.addEventListener('change', (e) => {
            const externalFileSection = document.getElementById('external-file-section');
            if (e.target.checked) {
                externalFileSection?.classList.add('hidden');
            }
        });
    }

    showConfigDiv() {
        const configDiv = document.getElementById('config-div');
        const trackingDiv = document.getElementById('tracking-div');
        const loadConfigBtn = document.getElementById('load-config');
        const activateTrackingBtn = document.getElementById('activate-tracking');

        configDiv?.classList.remove('is-hidden');
        trackingDiv?.classList.add('is-hidden');
        loadConfigBtn?.classList.add('ms-Button--primary');
        activateTrackingBtn?.classList.remove('ms-Button--primary');
        
        // Automatically reload config when switching to config mode
        if (this.orchestrator) {
            this.orchestrator.reloadConfig();
        } else {
            this.updateStatus('Load Config mode active - Configure your mapping settings');
        }
    }

    showTrackingDiv() {
        const trackingDiv = document.getElementById('tracking-div');
        const configDiv = document.getElementById('config-div');
        const activateTrackingBtn = document.getElementById('activate-tracking');
        const loadConfigBtn = document.getElementById('load-config');

        trackingDiv?.classList.remove('is-hidden');
        configDiv?.classList.add('is-hidden');
        activateTrackingBtn?.classList.add('ms-Button--primary');
        loadConfigBtn?.classList.remove('ms-Button--primary');
        
        // Automatically start tracking when switching to tracking mode
        if (this.orchestrator) {
            this.orchestrator.startTracking();
        } else {
            this.updateStatus('Tracking active (reverse-only)');
        }
    }

    updateStatus(message) {
        const statusMessage = document.getElementById('main-status-message');
        const bottomStatusMessage = document.getElementById('bottom-status-message');
        
        if (statusMessage) statusMessage.textContent = message;
        if (bottomStatusMessage) bottomStatusMessage.textContent = message;
    }

    async loadCurrentSheets() {
        try {
            const sheets = await this.excelIntegration.getCurrentWorksheetNames();
            this.setDropdown(sheets);
            this.status(`${sheets.length} worksheets found`);
        } catch (error) {
            this.setDropdown(['Error loading worksheets'], true);
            this.status(`Error: ${error.message}`, true);
        }
    }

    async loadExternalSheets() {
        if (!this.externalFile) return;
        
        try {
            const sheets = await this.excelIntegration.getExternalWorksheetNames(this.externalFile);
            this.setDropdown(sheets);
            this.status(`${sheets.length} worksheets found in ${this.externalFile.name}`);
            window.dispatchEvent(new CustomEvent('external-file-loaded'));
        } catch (error) {
            this.setDropdown(['Error reading file'], true);
            this.status(`Error: ${error.message}`, true);
        }
    }

    setDropdown(sheets, disabled = false) {
        const dropdown = document.getElementById('worksheet-dropdown');
        if (!dropdown) return;
        
        if (disabled) {
            dropdown.innerHTML = `<option value="">${sheets[0]}</option>`;
        } else {
            dropdown.innerHTML = '<option value="">Select a worksheet...</option>' +
                sheets.map(name => `<option value="${name}">${name}</option>`).join('');
        }
    }

    selectWorksheet(name) {
        if (!name) return;
        
        setTimeout(() => {
            const dropdown = document.getElementById('worksheet-dropdown');
            if (dropdown && Array.from(dropdown.options).find(opt => opt.value === name)) {
                dropdown.value = name;
                this.status(`Selected: ${name}`);
            }
        }, 100);
    }

    updateFromConfig(configManager) {
        const config = configManager.getConfig();
        if (!config) return;

        this.updateFields({
            'source-column': config.source_column || '',
            'target-column': config.target_column || config.mapping_reference || ''
        });

        if (configManager.isExternal()) {
            document.getElementById('external-file').checked = true;
            document.getElementById('external-file-section').style.display = 'block';
            document.getElementById('file-path-display').value = configManager.getFileName();
            this.setDropdown(['Browse for external file first...'], true);
            this.status(`Config expects: ${configManager.getFileName()}`);
        } else {
            document.getElementById('current-file').checked = true;
            document.getElementById('external-file-section').style.display = 'none';
            this.loadCurrentSheets().then(() => this.selectWorksheet(configManager.getWorksheet()));
        }
    }

    getMappingParams() {
        return {
            useCurrentFile: document.getElementById('current-file')?.checked ?? true,
            sheetName: document.getElementById('worksheet-dropdown')?.value,
            sourceColumn: document.getElementById('source-column')?.value || null,
            targetColumn: document.getElementById('target-column')?.value,
            externalFile: document.getElementById('current-file')?.checked ? null : this.externalFile
        };
    }

    status(message, isError = false, elementId = 'mapping-status') {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = message;
            element.style.color = isError ? '#D83B01' : '';
        }
    }

    updateFields(fields) {
        Object.entries(fields).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = value || '';
        });
    }

    setupMetadataToggle() {
        const btn = document.getElementById('show-metadata-btn');
        const content = document.getElementById('metadata-content');
        
        if (btn && content) {
            btn.addEventListener('click', () => {
                const isHidden = content.classList.contains('is-hidden');
                content.classList.toggle('is-hidden', !isHidden);
                const label = btn.querySelector('.ms-Button-label');
                if (label) label.textContent = isHidden ? 'Hide Processing Details' : 'Show Processing Details';
            });
        }
    }

    handleMappingSuccess(result, mappings) {
        const forward = Object.keys(mappings.forward).length;
        const reverse = Object.keys(mappings.reverse).length;
        const targetOnly = reverse - forward;
        
        let message = `${forward} mappings loaded`;
        if (targetOnly > 0) message += `, ${targetOnly} target-only`;
        if (result.metadata?.issues) message += ` (${result.metadata.issues.length} issues)`;
        
        this.status(message);
        this.metadataDisplay.show(result.metadata);
        document.getElementById('mapping-source-details').open = false;
        
        // Update main status as well
        this.updateStatus('Config loaded. 2 mappings configured');
    }

    handleMappingError(error, mappings) {
        mappings.forward = {};
        mappings.reverse = {};
        mappings.metadata = null;
        this.status(error.message, true);
        this.metadataDisplay.hide();
    }
}