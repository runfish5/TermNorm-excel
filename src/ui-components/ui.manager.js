// ui-components/ui.manager.js
import { MetadataDisplay } from './metadata.display.js';
import { ExcelIntegration } from '../services/excel-integration.js';
import { CandidateRankingUI } from './CandidateRankingUI.js';
import { state } from '../shared-services/state.manager.js';

export class UIManager {
    constructor() {
        this.metadataDisplay = new MetadataDisplay();
        this.excelIntegration = new ExcelIntegration();
        this.externalFile = null;
    }

    init() {
        this.metadataDisplay.init();
        this.setupEvents();
        this.loadSheets(false);
        CandidateRankingUI.init();
        this.showView('config');
        
        // Simple status subscription
        state.subscribe('ui', (ui) => {
            this.updateStatus(ui.statusMessage, ui.isError);
        });
        
        return this;
    }

    setupEvents() {
        // File source radios
        document.getElementById('current-file')?.addEventListener('change', () => {
            document.getElementById('external-file-section')?.classList.add('hidden');
            this.loadSheets(false);
        });
        
        document.getElementById('external-file')?.addEventListener('change', () => {
            document.getElementById('external-file-section')?.classList.remove('hidden');
            if (this.externalFile) this.loadSheets(true);
            else this.setDropdown(['Select external file first...'], true);
        });
        
        // File picker
        document.getElementById('browse-button')?.addEventListener('click', e => {
            e.preventDefault();
            document.getElementById('file-picker-input')?.click();
        });
        
        document.getElementById('file-picker-input')?.addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (!file) return;
            
            this.externalFile = file;
            document.getElementById('file-path-display').value = file.name;
            document.getElementById('external-file').checked = true;
            document.getElementById('external-file-section')?.classList.remove('hidden');
            
            state.setStatus(`Reading ${file.name}...`);
            this.loadSheets(true);
        });

        // Metadata toggle
        document.getElementById('show-metadata-btn')?.addEventListener('click', () => {
            const content = document.getElementById('metadata-content');
            const isHidden = content?.classList.toggle('hidden');
            const label = document.querySelector('#show-metadata-btn .ms-Button-label');
            if (label) label.textContent = isHidden ? 'Show Processing Details' : 'Hide Processing Details';
        });
    }

    showView(viewName) {
        document.getElementById('config-div')?.classList.toggle('hidden', viewName !== 'config');
        document.getElementById('tracking-div')?.classList.toggle('hidden', viewName !== 'tracking');
        document.getElementById('load-config')?.classList.toggle('ms-Button--primary', viewName === 'config');
        document.getElementById('activate-tracking')?.classList.toggle('ms-Button--primary', viewName === 'tracking');
        state.setView(viewName);
    }

    async loadSheets(isExternal = false) {
        if (isExternal && !this.externalFile) {
            this.setDropdown(['Select external file first...'], true);
            return;
        }

        try {
            const sheets = isExternal 
                ? await this.excelIntegration.getExternalWorksheetNames(this.externalFile)
                : await this.excelIntegration.getCurrentWorksheetNames();
            
            this.setDropdown(sheets);
            state.setStatus(`${sheets.length} worksheets found${isExternal ? ` in ${this.externalFile.name}` : ''}`);
            
            if (isExternal) window.dispatchEvent(new CustomEvent('external-file-loaded'));
        } catch (error) {
            this.setDropdown(['Error loading worksheets'], true);
            state.setStatus(`Error: ${error.message}`, true);
        }
    }

    setDropdown(sheets, disabled = false) {
        const dropdown = document.getElementById('worksheet-dropdown');
        if (!dropdown) return;
        
        if (disabled) {
            dropdown.innerHTML = `<option value="">${sheets[0]}</option>`;
            dropdown.disabled = true;
        } else {
            dropdown.innerHTML = '<option value="">Select a worksheet...</option>' + 
                sheets.map(name => `<option value="${name}">${name}</option>`).join('');
            dropdown.disabled = false;
        }
    }

    selectWorksheet(name) {
        const dropdown = document.getElementById('worksheet-dropdown');
        if (!name || !dropdown) return;
        
        const optionExists = Array.from(dropdown.options).some(opt => opt.value === name);
        if (optionExists) {
            dropdown.value = name;
            state.setStatus(`Selected: ${name}`);
        }
    }

    updateFromConfig(configManager) {
        const config = configManager.getConfig();
        if (!config) return;
        
        // Use the new methods to get values from the first standard mapping
        document.getElementById('source-column').value = configManager.getSourceColumn();
        document.getElementById('target-column').value = configManager.getTargetColumn() || configManager.getMappingReference();
        
        const isExternal = configManager.isExternal();
        document.getElementById(isExternal ? 'external-file' : 'current-file').checked = true;
        document.getElementById('external-file-section')?.classList.toggle('hidden', !isExternal);
        
        if (isExternal) {
            document.getElementById('file-path-display').value = configManager.getFileName();
            state.setStatus(`Config expects: ${configManager.getFileName()}`);
            this.setDropdown(['Browse for external file first...'], true);
        } else {
            this.loadSheets(false).then(() => this.selectWorksheet(configManager.getWorksheet()));
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

    handleMappingSuccess(result, mappings) {
        const forward = Object.keys(mappings.forward).length;
        const reverse = Object.keys(mappings.reverse).length;
        const targetOnly = reverse - forward;
        
        let message = `${forward} mappings loaded`;
        if (targetOnly > 0) message += `, ${targetOnly} target-only`;
        if (result.metadata?.issues) message += ` (${result.metadata.issues.length} issues)`;
        
        state.setStatus(message);
        state.setMappings(mappings.forward, mappings.reverse, result.metadata);
        this.metadataDisplay.show(result.metadata);
        document.getElementById('mapping-source-details').open = false;
    }

    handleMappingError(error, mappings) {
        mappings.forward = {};
        mappings.reverse = {};
        mappings.metadata = null;
        
        state.setStatus(error.message, true);
        state.clearMappings();
        this.metadataDisplay.hide();
    }
}