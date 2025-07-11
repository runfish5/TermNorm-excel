// ui-components/ui.manager.js
import { MetadataDisplay } from './metadata.display.js';
import { ExcelIntegration } from '../services/excel-integration.js';
import { CandidateRankingUI } from './CandidateRankingUI.js';

export class UIManager {
    constructor() {
        this.metadataDisplay = new MetadataDisplay();
        this.excelIntegration = new ExcelIntegration();
        this.externalFile = null;
        // Cache frequently used DOM elements
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
        this.elements = {
            currentFile: document.getElementById('current-file'),
            externalFile: document.getElementById('external-file'),
            externalFileSection: document.getElementById('external-file-section'),
            filePathDisplay: document.getElementById('file-path-display'),
            worksheetDropdown: document.getElementById('worksheet-dropdown'),
            statusMessage: document.getElementById('main-status-message')
        };
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
        // Simplified file source handling
        this.elements.currentFile?.addEventListener('change', () => this.handleFileSourceChange());
        this.elements.externalFile?.addEventListener('change', () => this.handleFileSourceChange());

        // File picker
        document.getElementById('browse-button')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('file-picker-input')?.click();
        });

        document.getElementById('file-picker-input')?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (file) {
                this.handleFileSelected(file);
            }
        });

        // Metadata toggle
        document.getElementById('show-metadata-btn')?.addEventListener('click', () => {
            this.toggleMetadata();
        });
    }

    handleFileSourceChange() {
        const useExternal = this.elements.externalFile?.checked;
        this.elements.externalFileSection?.classList.toggle('hidden', !useExternal);
        
        if (useExternal) {
            this.externalFile ? this.loadSheets(true) : this.setDropdown(['Select external file first...'], true);
        } else {
            this.loadSheets(false);
        }
    }

    handleFileSelected(file) {
        this.externalFile = file;
        this.elements.filePathDisplay.value = file.name;
        this.status(`Reading ${file.name}...`);
        this.loadSheets(true);
    }

    toggleMetadata() {
        const content = document.getElementById('metadata-content');
        const isHidden = content?.classList.toggle('hidden');
        const label = document.querySelector('#show-metadata-btn .ms-Button-label');
        if (label) label.textContent = isHidden ? 'Show Processing Details' : 'Hide Processing Details';
    }

    async loadSheets(isExternal = false) {
        // Guard clause for external files
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
        if (!this.elements.worksheetDropdown) return;
        
        this.elements.worksheetDropdown.innerHTML = disabled 
            ? `<option value="">${sheets[0]}</option>`
            : '<option value="">Select a worksheet...</option>' + 
              sheets.map(name => `<option value="${name}">${name}</option>`).join('');
    }

    selectWorksheet(name) {
        if (!name || !this.elements.worksheetDropdown) return;
        if (Array.from(this.elements.worksheetDropdown.options).find(opt => opt.value === name)) {
            this.elements.worksheetDropdown.value = name;
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
        this.elements[isExternal ? 'externalFile' : 'currentFile'].checked = true;
        this.elements.externalFileSection?.classList.toggle('hidden', !isExternal);
        
        if (isExternal) {
            this.elements.filePathDisplay.value = configManager.getFileName();
            this.status(`Config expects: ${configManager.getFileName()}`);
            this.setDropdown(['Browse for external file first...'], true);
        } else {
            this.loadSheets(false).then(() => this.selectWorksheet(configManager.getWorksheet()));
        }
    }



    status(message, isError = false) {
        if (this.elements.statusMessage) {
            this.elements.statusMessage.textContent = message;
            this.elements.statusMessage.style.setProperty('color', isError ? '#D83B01' : '');
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