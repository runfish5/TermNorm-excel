// ui-components/ui.manager.js
import { MetadataDisplay } from './metadata.display.js';
import { ExcelIntegration } from '../services/excel-integration.js';
import { CandidateRankingUI } from './CandidateRankingUI.js';

export class UIManager {
    constructor() {
        this.metadataDisplay = new MetadataDisplay();
        this.excelIntegration = new ExcelIntegration();
        this.externalFile = null;
    }

    init() {
        this.metadataDisplay.init();
        this.setupEvents();
        this.loadCurrentSheets();
        CandidateRankingUI.init();
        this.showView('config');
        return this;
    }

    showView(viewName) {
        const views = { config: 'config-div', tracking: 'tracking-div' };
        const buttons = { config: 'load-config', tracking: 'activate-tracking' };
        
        // Toggle all views and buttons
        Object.entries(views).forEach(([name, divId]) => {
            document.getElementById(divId)?.classList.toggle('hidden', name !== viewName);
            document.getElementById(buttons[name])?.classList.toggle('ms-Button--primary', name === viewName);
        });
    }

    setupEvents() {
        // File source radio buttons
        document.getElementById('current-file')?.addEventListener('change', () => {
            document.getElementById('external-file-section')?.classList.add('hidden');
            this.loadCurrentSheets();
        });

        document.getElementById('external-file')?.addEventListener('change', (e) => {
            const section = document.getElementById('external-file-section');
            section?.classList.toggle('hidden', !e.target.checked);
            if (e.target.checked) {
                this.externalFile ? this.loadExternalSheets() : this.setDropdown(['Select external file first...'], true);
            }
        });

        // File picker
        document.getElementById('browse-button')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('file-picker-input')?.click();
        });

        document.getElementById('file-picker-input')?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) {
                this.externalFile = file;
                document.getElementById('file-path-display').value = file.name;
                this.status(`Reading ${file.name}...`);
                this.loadExternalSheets();
            }
        });

        // Activity toggles
        ['activity-history', 'activity-ranked'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                const showHistory = document.getElementById('activity-history')?.checked;
                document.getElementById('activity-feed')?.classList.toggle('hidden', !showHistory);
                document.getElementById('candidate-ranked')?.classList.toggle('hidden', showHistory);
            });
        });

        // Metadata toggle
        document.getElementById('show-metadata-btn')?.addEventListener('click', () => {
            const content = document.getElementById('metadata-content');
            const isHidden = content?.classList.toggle('hidden');
            const label = document.querySelector('#show-metadata-btn .ms-Button-label');
            if (label) label.textContent = isHidden ? 'Show Processing Details' : 'Hide Processing Details';
        });
    }

    async loadSheets(isExternal = false) {
        try {
            const sheets = isExternal 
                ? await this.excelIntegration.getExternalWorksheetNames(this.externalFile)
                : await this.excelIntegration.getCurrentWorksheetNames();
            
            this.setDropdown(sheets);
            this.status(`${sheets.length} worksheets found${isExternal ? ` in ${this.externalFile.name}` : ''}`);
            
            if (isExternal) window.dispatchEvent(new CustomEvent('external-file-loaded'));
        } catch (error) {
            this.setDropdown(['Error loading worksheets'], true);
            this.status(`Error: ${error.message}`, true);
        }
    }

    loadCurrentSheets() { return this.loadSheets(false); }
    loadExternalSheets() { return this.externalFile ? this.loadSheets(true) : null; }

    setDropdown(sheets, disabled = false) {
        const dropdown = document.getElementById('worksheet-dropdown');
        if (!dropdown) return;

        dropdown.innerHTML = disabled 
            ? `<option value="">${sheets[0]}</option>`
            : '<option value="">Select a worksheet...</option>' + 
              sheets.map(name => `<option value="${name}">${name}</option>`).join('');
    }

    selectWorksheet(name) {
        if (!name) return;
        const dropdown = document.getElementById('worksheet-dropdown');
        if (Array.from(dropdown.options).find(opt => opt.value === name)) {
            dropdown.value = name;
            this.status(`Selected: ${name}`);
        }
    }

    updateFromConfig(configManager) {
        const config = configManager.getConfig();
        if (!config) return;
        
        // Update form fields
        document.getElementById('source-column').value = config.source_column || '';
        document.getElementById('target-column').value = config.target_column || config.mapping_reference || '';

        // Handle file source
        const isExternal = configManager.isExternal();
        document.getElementById(isExternal ? 'external-file' : 'current-file').checked = true;
        document.getElementById('external-file-section')?.classList.toggle('hidden', !isExternal);
        
        if (isExternal) {
            document.getElementById('file-path-display').value = configManager.getFileName();
            this.status(`Config expects: ${configManager.getFileName()}`);
            this.setDropdown(['Browse for external file first...'], true);
        } else {
            this.loadCurrentSheets().then(() => this.selectWorksheet(configManager.getWorksheet()));
        }
    }

    getMappingParams() {
        return {
            useCurrentFile: document.getElementById('current-file')?.checked,
            sheetName: document.getElementById('worksheet-dropdown')?.value,
            sourceColumn: document.getElementById('source-column')?.value || null,
            targetColumn: document.getElementById('target-column')?.value,
            externalFile: document.getElementById('current-file')?.checked ? null : this.externalFile
        };
    }

    status(message, isError = false, elementId = 'mapping-status') {
        document.getElementById(elementId)?.style.setProperty('color', isError ? '#D83B01' : '');
        document.getElementById(elementId) && (document.getElementById(elementId).textContent = message);
        document.getElementById('main-status-message') && (document.getElementById('main-status-message').textContent = message);
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
    }

    handleMappingError(error, mappings) {
        Object.assign(mappings, { forward: {}, reverse: {}, metadata: null });
        this.status(error.message, true);
        this.metadataDisplay.hide();
    }

    // Convenience methods
    showConfigDiv() { this.showView('config'); }
    showTrackingDiv() { this.showView('tracking'); }
}