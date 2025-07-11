// ui-components/ui.manager.js
import { MetadataDisplay } from './metadata.display.js';
import { ExcelIntegration } from '../services/excel-integration.js';
import { CandidateRankingUI } from './CandidateRankingUI.js';

export class UIManager {
    constructor() {
        this.metadataDisplay = new MetadataDisplay();
        this.excelIntegration = new ExcelIntegration();
        this.externalFile = null;
        this.currentView = 'config';
        this.worksheetState = null;
        this.elements = {};
    }

    init() {
        this.metadataDisplay.init();
        this.cacheElements();
        this.setupEvents();
        this.loadSheets(false);
        CandidateRankingUI.init();
        this.showView('config');
        return this;
    }

    cacheElements() {
        const ids = ['current-file', 'external-file', 'external-file-section', 
                    'file-path-display', 'worksheet-dropdown', 'main-status-message'];
        ids.forEach(id => this.elements[id] = document.getElementById(id));
    }

    showView(viewName) {
        if (this.currentView === 'config') this.saveWorksheetState();
        
        document.getElementById('config-div')?.classList.toggle('hidden', viewName !== 'config');
        document.getElementById('tracking-div')?.classList.toggle('hidden', viewName !== 'tracking');
        document.getElementById('load-config')?.classList.toggle('ms-Button--primary', viewName === 'config');
        document.getElementById('activate-tracking')?.classList.toggle('ms-Button--primary', viewName === 'tracking');
        
        this.currentView = viewName;
        if (viewName === 'config' && this.worksheetState) this.restoreWorksheetState();
    }

    saveWorksheetState() {
        if (!this.elements['worksheet-dropdown']) return;
        this.worksheetState = {
            selected: this.elements['worksheet-dropdown'].value,
            isExternal: this.elements['external-file']?.checked || false,
            file: this.externalFile,
            fileName: this.elements['file-path-display']?.value || ''
        };
    }

    restoreWorksheetState() {
        const state = this.worksheetState;
        this.elements['external-file'].checked = state.isExternal;
        this.elements['current-file'].checked = !state.isExternal;
        this.elements['external-file-section']?.classList.toggle('hidden', !state.isExternal);
        
        if (state.isExternal && state.file) {
            this.externalFile = state.file;
            this.elements['file-path-display'].value = state.fileName;
        }
        
        this.loadSheets(state.isExternal).then(() => {
            if (state.selected) this.selectWorksheet(state.selected);
        });
    }

    setupEvents() {
        this.elements['current-file']?.addEventListener('change', () => this.handleFileSourceChange());
        this.elements['external-file']?.addEventListener('change', () => this.handleFileSourceChange());
        
        document.getElementById('browse-button')?.addEventListener('click', e => {
            e.preventDefault();
            document.getElementById('file-picker-input')?.click();
        });

        document.getElementById('file-picker-input')?.addEventListener('change', e => {
            if (e.target.files?.[0]) this.handleFileSelected(e.target.files[0]);
        });

        document.getElementById('show-metadata-btn')?.addEventListener('click', () => this.toggleMetadata());
    }

    handleFileSourceChange() {
        const useExternal = this.elements['external-file']?.checked;
        this.elements['external-file-section']?.classList.toggle('hidden', !useExternal);
        
        if (useExternal && !this.externalFile) {
            this.setDropdown(['Select external file first...'], true);
        } else {
            this.loadSheets(useExternal);
        }
    }

    handleFileSelected(file) {
        this.externalFile = file;
        this.elements['file-path-display'].value = file.name;
        this.elements['external-file'].checked = true;
        this.elements['current-file'].checked = false;
        this.elements['external-file-section']?.classList.remove('hidden');
        this.status(`Reading ${file.name}...`);
        this.loadSheets(true);
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
            this.status(`${sheets.length} worksheets found${isExternal ? ` in ${this.externalFile.name}` : ''}`);
            
            if (isExternal) window.dispatchEvent(new CustomEvent('external-file-loaded'));
        } catch (error) {
            this.setDropdown(['Error loading worksheets'], true);
            this.status(`Error: ${error.message}`, true);
        }
    }

    setDropdown(sheets, disabled = false) {
        if (!this.elements['worksheet-dropdown']) return;
        
        this.elements['worksheet-dropdown'].innerHTML = disabled 
            ? `<option value="">${sheets[0]}</option>`
            : '<option value="">Select a worksheet...</option>' + 
              sheets.map(name => `<option value="${name}">${name}</option>`).join('');
        this.elements['worksheet-dropdown'].disabled = disabled;
    }

    selectWorksheet(name) {
        if (!name || !this.elements['worksheet-dropdown']) return;
        if (Array.from(this.elements['worksheet-dropdown'].options).find(opt => opt.value === name)) {
            this.elements['worksheet-dropdown'].value = name;
            this.status(`Selected: ${name}`);
        }
    }

    toggleMetadata() {
        const content = document.getElementById('metadata-content');
        const isHidden = content?.classList.toggle('hidden');
        const label = document.querySelector('#show-metadata-btn .ms-Button-label');
        if (label) label.textContent = isHidden ? 'Show Processing Details' : 'Hide Processing Details';
    }

    updateFromConfig(configManager) {
        const config = configManager.getConfig();
        if (!config) return;
        
        document.getElementById('source-column').value = config.source_column || '';
        document.getElementById('target-column').value = config.target_column || config.mapping_reference || '';
        
        const isExternal = configManager.isExternal();
        this.elements[isExternal ? 'external-file' : 'current-file'].checked = true;
        this.elements['external-file-section']?.classList.toggle('hidden', !isExternal);
        
        if (isExternal) {
            this.elements['file-path-display'].value = configManager.getFileName();
            this.status(`Config expects: ${configManager.getFileName()}`);
            this.setDropdown(['Browse for external file first...'], true);
        } else {
            this.loadSheets(false).then(() => this.selectWorksheet(configManager.getWorksheet()));
        }
    }

    status(message, isError = false) {
        if (this.elements['main-status-message']) {
            this.elements['main-status-message'].textContent = message;
            this.elements['main-status-message'].style.color = isError ? '#D83B01' : '';
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
    }

    handleMappingError(error, mappings) {
        Object.assign(mappings, { forward: {}, reverse: {}, metadata: null });
        this.status(error.message, true);
        this.metadataDisplay.hide();
    }
}