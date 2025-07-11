// ui-components/mapping-config-module.js
import { ExcelIntegration } from '../services/excel-integration.js';
import { loadAndProcessMappings } from '../data-processing/mapping.processor.js';
import { state } from '../shared-services/state.manager.js';

export class MappingConfigModule {
    constructor(mappingConfig, index, onMappingLoaded) {
        this.mappingConfig = mappingConfig;
        this.index = index;
        this.onMappingLoaded = onMappingLoaded;
        this.excelIntegration = new ExcelIntegration();
        this.externalFile = null;
        this.elementId = `mapping-config-${index}`;
        this.mappings = { forward: {}, reverse: {}, metadata: null };
    }

    createElement() {
        const element = document.createElement('details');
        element.id = this.elementId;
        element.className = 'ms-welcome__section mapping-config-module';
        element.open = true;
        
        element.innerHTML = `
            <summary class="ms-font-xl">
                Mapping Configuration ${this.index + 1}
                <span class="mapping-status" id="${this.elementId}-status">Not loaded</span>
            </summary>
            
            <div class="form-section">
                <label class="enhanced-label">Excel File:</label>
                <div>
                    <input type="radio" id="${this.elementId}-current-file" name="${this.elementId}-file-source" value="current" checked />
                    <label for="${this.elementId}-current-file" class="ms-font-m">This Excel file</label>
                </div>
                <div>
                    <input type="radio" id="${this.elementId}-external-file" name="${this.elementId}-file-source" value="external" />
                    <label for="${this.elementId}-external-file" class="ms-font-m">External Excel file</label>
                </div>
                <div id="${this.elementId}-external-file-section" class="hidden">
                    <label for="${this.elementId}-file-path-display" class="ms-font-m">File Path:</label>
                    <div class="file-row">
                        <input type="text" id="${this.elementId}-file-path-display" class="ms-TextField-field" placeholder="No file selected" readonly />
                        <input type="file" id="${this.elementId}-file-picker-input" accept=".xlsx,.xls" class="hidden" />
                        <button id="${this.elementId}-browse-button" class="ms-Button">Browse...</button>
                    </div>
                </div>
            </div>
            
            <div class="form-section">
                <label for="${this.elementId}-worksheet-dropdown" class="enhanced-label">Worksheet:</label>
                <select id="${this.elementId}-worksheet-dropdown" class="ms-Dropdown-select">
                    <option value="">Select a worksheet...</option>
                </select>
            </div>
            
            <div class="form-section">
                <div class="columns">
                    <div>
                        <label for="${this.elementId}-target-column" class="enhanced-label">Reference Column:</label>
                        <input type="text" id="${this.elementId}-target-column" class="ms-TextField-field" />
                    </div>
                    <div>
                        <label for="${this.elementId}-source-column" class="enhanced-label">Alias Column:</label>
                        <input type="text" id="${this.elementId}-source-column" class="ms-TextField-field" placeholder="optional" />
                    </div>
                </div>
            </div>
            
            <button id="${this.elementId}-load-mapping" class="ms-Button ms-Button--primary ms-font-l btn-full">
                Load Mapping Table ${this.index + 1}
            </button>
            
            <div id="${this.elementId}-metadata" class="mapping-metadata hidden">
                <h4 class="ms-font-m">Mapping Details</h4>
                <div id="${this.elementId}-metadata-content" class="ms-font-s"></div>
            </div>
        `;
        
        return element;
    }

    init(container) {
        const element = this.createElement();
        container.appendChild(element);
        this.setupEvents();
        this.loadInitialData();
        return element;
    }

    setupEvents() {
        // File source radios
        document.getElementById(`${this.elementId}-current-file`)?.addEventListener('change', () => {
            document.getElementById(`${this.elementId}-external-file-section`)?.classList.add('hidden');
            this.loadSheets(false);
        });
        
        document.getElementById(`${this.elementId}-external-file`)?.addEventListener('change', () => {
            document.getElementById(`${this.elementId}-external-file-section`)?.classList.remove('hidden');
            if (this.externalFile) this.loadSheets(true);
            else this.setDropdown(['Select external file first...'], true);
        });
        
        // File picker
        document.getElementById(`${this.elementId}-browse-button`)?.addEventListener('click', e => {
            e.preventDefault();
            document.getElementById(`${this.elementId}-file-picker-input`)?.click();
        });
        
        document.getElementById(`${this.elementId}-file-picker-input`)?.addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (!file) return;
            
            this.externalFile = file;
            document.getElementById(`${this.elementId}-file-path-display`).value = file.name;
            document.getElementById(`${this.elementId}-external-file`).checked = true;
            document.getElementById(`${this.elementId}-external-file-section`)?.classList.remove('hidden');
            
            this.updateStatus(`Reading ${file.name}...`);
            this.loadSheets(true);
        });

        // Load mapping button
        document.getElementById(`${this.elementId}-load-mapping`)?.addEventListener('click', () => {
            this.loadMappings();
        });
    }

    loadInitialData() {
        // Pre-fill form with config data
        if (this.mappingConfig.source_column) {
            document.getElementById(`${this.elementId}-source-column`).value = this.mappingConfig.source_column;
        }
        if (this.mappingConfig.target_column) {
            document.getElementById(`${this.elementId}-target-column`).value = this.mappingConfig.target_column;
        }
        
        // Determine if external file
        const isExternal = this.isExternalFile();
        if (isExternal) {
            document.getElementById(`${this.elementId}-external-file`).checked = true;
            document.getElementById(`${this.elementId}-external-file-section`)?.classList.remove('hidden');
            const fileName = this.parseFileName(this.mappingConfig.mapping_reference);
            document.getElementById(`${this.elementId}-file-path-display`).value = fileName;
            this.updateStatus(`Config expects: ${fileName}`);
            this.setDropdown(['Browse for external file first...'], true);
        } else {
            this.loadSheets(false).then(() => {
                if (this.mappingConfig.worksheet) {
                    this.selectWorksheet(this.mappingConfig.worksheet);
                }
            });
        }
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
            this.updateStatus(`${sheets.length} worksheets found${isExternal ? ` in ${this.externalFile.name}` : ''}`);
            
            // Auto-select worksheet if specified in config
            if (this.mappingConfig.worksheet && !isExternal) {
                this.selectWorksheet(this.mappingConfig.worksheet);
            }
        } catch (error) {
            this.setDropdown(['Error loading worksheets'], true);
            this.updateStatus(`Error: ${error.message}`, true);
        }
    }

    setDropdown(sheets, disabled = false) {
        const dropdown = document.getElementById(`${this.elementId}-worksheet-dropdown`);
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
        const dropdown = document.getElementById(`${this.elementId}-worksheet-dropdown`);
        if (!name || !dropdown) return;
        
        const optionExists = Array.from(dropdown.options).some(opt => opt.value === name);
        if (optionExists) {
            dropdown.value = name;
            this.updateStatus(`Selected: ${name}`);
        }
    }

    async loadMappings() {
        try {
            this.updateStatus("Loading...");
            
            const customParams = {
                useCurrentFile: document.getElementById(`${this.elementId}-current-file`)?.checked || false,
                sheetName: document.getElementById(`${this.elementId}-worksheet-dropdown`)?.value || '',
                sourceColumn: document.getElementById(`${this.elementId}-source-column`)?.value || null,
                targetColumn: document.getElementById(`${this.elementId}-target-column`)?.value || '',
                externalFile: this.externalFile
            };
            
            const result = await loadAndProcessMappings(customParams);
            this.mappings = {
                forward: result.forward || {},
                reverse: result.reverse || {},
                metadata: result.metadata || null
            };
            
            this.handleMappingSuccess(result);
            
            // Notify parent
            if (this.onMappingLoaded) {
                this.onMappingLoaded(this.index, this.mappings, result);
            }
        } catch (error) {
            this.handleMappingError(error);
        }
    }

    handleMappingSuccess(result) {
        const forward = Object.keys(this.mappings.forward).length;
        const reverse = Object.keys(this.mappings.reverse).length;
        const targetOnly = reverse - forward;
        
        let message = `${forward} mappings loaded`;
        if (targetOnly > 0) message += `, ${targetOnly} target-only`;
        if (result.metadata?.issues) message += ` (${result.metadata.issues.length} issues)`;
        
        this.updateStatus(message, false, 'success');
        this.showMetadata(result.metadata);
    }

    handleMappingError(error) {
        this.mappings = { forward: {}, reverse: {}, metadata: null };
        this.updateStatus(error.message, true);
        this.hideMetadata();
    }

    showMetadata(metadata) {
        if (!metadata) return;
        
        const metadataDiv = document.getElementById(`${this.elementId}-metadata`);
        const contentDiv = document.getElementById(`${this.elementId}-metadata-content`);
        
        if (!metadataDiv || !contentDiv) return;
        
        let html = '';
        if (metadata.summary) {
            html += `<div><strong>Summary:</strong> ${metadata.summary}</div>`;
        }
        if (metadata.issues && metadata.issues.length > 0) {
            html += `<div><strong>Issues:</strong> ${metadata.issues.length} found</div>`;
        }
        
        contentDiv.innerHTML = html;
        metadataDiv.classList.remove('hidden');
    }

    hideMetadata() {
        const metadataDiv = document.getElementById(`${this.elementId}-metadata`);
        if (metadataDiv) {
            metadataDiv.classList.add('hidden');
        }
    }

    updateStatus(message, isError = false, type = 'info') {
        const statusElement = document.getElementById(`${this.elementId}-status`);
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = `mapping-status ${type}`;
            if (isError) {
                statusElement.className += ' error';
            }
        }
    }

    isExternalFile() {
        const ref = this.mappingConfig.mapping_reference;
        return ref && (ref.includes('/') || ref.includes('\\'));
    }

    parseFileName(path) {
        return path?.split(/[\\/]/).pop();
    }

    getMappings() {
        return this.mappings;
    }

    getConfig() {
        return this.mappingConfig;
    }
}