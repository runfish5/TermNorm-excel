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
        this.showConfigDiv();
        return this;
    }

    setupEvents() {
        // File source
        document.getElementById('current-file')?.addEventListener('change', () => {
            document.getElementById('external-file-section').classList.add('hidden');
            this.loadCurrentSheets();
        });

        document.getElementById('external-file')?.addEventListener('change', (e) => {
            const section = document.getElementById('external-file-section');
            if (e.target.checked) {
                section.classList.remove('hidden');
                this.externalFile ? this.loadExternalSheets() : this.setDropdown(['Select external file first...'], true);
            } else {
                section.classList.add('hidden');
            }
        });

        // File picker
        document.getElementById('browse-button')?.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('file-picker-input').click();
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

        // Activity toggles
        const historyRadio = document.getElementById('activity-history');
        const rankedRadio = document.getElementById('activity-ranked');
        if (historyRadio && rankedRadio) {
            const toggleView = () => {
                const showHistory = historyRadio.checked;
                document.getElementById('activity-feed')?.classList.toggle('hidden', !showHistory);
                document.getElementById('candidate-ranked')?.classList.toggle('hidden', showHistory);
            };
            historyRadio.addEventListener('change', toggleView);
            rankedRadio.addEventListener('change', toggleView);
        }

        // Metadata toggle
        document.getElementById('show-metadata-btn')?.addEventListener('click', () => {
            const content = document.getElementById('metadata-content');
            const isHidden = content.classList.toggle('hidden');
            const label = document.querySelector('#show-metadata-btn .ms-Button-label');
            if (label) label.textContent = isHidden ? 'Show Processing Details' : 'Hide Processing Details';
        });
    }

    showConfigDiv() {
        document.getElementById('config-div').classList.remove('hidden');
        document.getElementById('tracking-div').classList.add('hidden');
        document.getElementById('load-config').classList.add('ms-Button--primary');
        document.getElementById('activate-tracking').classList.remove('ms-Button--primary');
    }

    showTrackingDiv() {
        document.getElementById('tracking-div').classList.remove('hidden');
        document.getElementById('config-div').classList.add('hidden');
        document.getElementById('activate-tracking').classList.add('ms-Button--primary');
        document.getElementById('load-config').classList.remove('ms-Button--primary');
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
        if (disabled) {
            dropdown.innerHTML = `<option value="">${sheets[0]}</option>`;
        } else {
            dropdown.innerHTML = '<option value="">Select a worksheet...</option>' +
                sheets.map(name => `<option value="${name}">${name}</option>`).join('');
        }
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
        
        document.getElementById('source-column').value = config.source_column || '';
        document.getElementById('target-column').value = config.target_column || config.mapping_reference || '';

        if (configManager.isExternal()) {
            document.getElementById('external-file').checked = true;
            document.getElementById('external-file-section').classList.remove('hidden');
            document.getElementById('file-path-display').value = configManager.getFileName();
            this.setDropdown(['Browse for external file first...'], true);
            this.status(`Config expects: ${configManager.getFileName()}`);
        } else {
            document.getElementById('current-file').checked = true;
            document.getElementById('external-file-section').classList.add('hidden');
            this.loadCurrentSheets().then(() => this.selectWorksheet(configManager.getWorksheet()));
        }
    }

    getMappingParams() {
        return {
            useCurrentFile: document.getElementById('current-file').checked,
            sheetName: document.getElementById('worksheet-dropdown').value,
            sourceColumn: document.getElementById('source-column').value || null,
            targetColumn: document.getElementById('target-column').value,
            externalFile: document.getElementById('current-file').checked ? null : this.externalFile
        };
    }

    status(message, isError = false, elementId = 'mapping-status') {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = message;
            element.style.color = isError ? '#D83B01' : '';
        }
        
        document.getElementById('main-status-message').textContent = message;
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
        mappings.forward = {};
        mappings.reverse = {};
        mappings.metadata = null;
        this.status(error.message, true);
        this.metadataDisplay.hide();
    }
}