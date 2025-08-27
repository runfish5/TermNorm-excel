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
        this.cloudFileUrl = null;
        this.fileType = 'local'; // 'local' or 'cloud'
        this.elementId = `mapping-config-${index}`;
        this.mappings = { forward: {}, reverse: {}, metadata: null };
    }
    createElement() {
        const element = document.createElement('details');
        element.id = this.elementId;
        element.className = 'ms-welcome__section mapping-config-module';
        element.open = true;
        
        element.innerHTML = `
            <summary class="ms-font-m">
                Map Config ${this.index + 1}
                <span id="${this.elementId}-filename-display" style="margin-left: 10px; font-style: italic; color: #666;"></span>
            </summary>
            <div class="form-section first-form-section">
                <div class="radio-group">
                    <label>Excel File:</label>
                    <div>
                        <input type="radio" id="${this.elementId}-current-file" name="${this.elementId}-file-source" value="current" checked />
                        <label for="${this.elementId}-current-file" class="ms-font-m">This Excel file</label>
                    </div>
                    <div>
                        <input type="radio" id="${this.elementId}-external-file" name="${this.elementId}-file-source" value="external" />
                        <label for="${this.elementId}-external-file" class="ms-font-m">External Excel file</label>
                    </div>
                </div>
                <div id="${this.elementId}-external-file-section" class="hidden form-section">
                    <div class="file-row">
                        <label for="${this.elementId}-file-path-display" class="ms-font-m">File Path:</label>
                        <input type="text" id="${this.elementId}-file-path-display" placeholder="No file selected" readonly />
                        <input type="file" id="${this.elementId}-file-picker-input" accept=".xlsx,.xls" class="hidden" />
                        <button id="${this.elementId}-browse-button" class="ms-Button">Browse Local...</button>
                        <button id="${this.elementId}-cloud-picker-button" class="ms-Button ms-Button--primary">Browse Cloud...</button>
                    </div>
                    <div class="file-type-indicator">
                        <span id="${this.elementId}-file-type" class="ms-font-xs"></span>
                    </div>
                </div>
            </div>
            
            <div class="form-section">
                <label for="${this.elementId}-worksheet-dropdown">Worksheet:</label>
                <select id="${this.elementId}-worksheet-dropdown">
                    <option value="">Select a worksheet...</option>
                </select>
            </div>
            
            <div class="form-section">
                <div class="columns">
                    <div>
                        <label for="${this.elementId}-target-column">Reference Column:</label>
                        <input type="text" id="${this.elementId}-target-column" />
                    </div>
                    <div>
                        <label for="${this.elementId}-source-column">Alias Column:</label>
                        <input type="text" id="${this.elementId}-source-column" placeholder="optional" />
                    </div>
                </div>
            </div>
            
            <button id="${this.elementId}-load-mapping" class="btn-full form-section">
                Load Mapping Table ${this.index + 1}
            </button>
            
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
        
        // Local file picker
        document.getElementById(`${this.elementId}-browse-button`)?.addEventListener('click', e => {
            e.preventDefault();
            document.getElementById(`${this.elementId}-file-picker-input`)?.click();
        });

        // Cloud file picker
        document.getElementById(`${this.elementId}-cloud-picker-button`)?.addEventListener('click', e => {
            e.preventDefault();
            this.openCloudFilePicker();
        });
        
        document.getElementById(`${this.elementId}-file-picker-input`)?.addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (!file) return;
            
            this.setLocalFile(file);
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
        if (isExternal && !this.externalFile && !this.cloudFileUrl) {
            this.setDropdown(['Select external file first...'], true);
            return;
        }
        try {
            let sheets;
            if (isExternal) {
                if (this.fileType === 'cloud' && this.cloudFileUrl) {
                    // For cloud files, we'll load sheets during processing
                    // For now, show a placeholder
                    sheets = ['Loading from cloud...'];
                    this.setDropdown(sheets, true);
                    this.updateStatus(`Cloud file connected: ${this.parseFileName(this.cloudFileUrl)}`);
                    return;
                } else if (this.externalFile) {
                    sheets = await this.excelIntegration.getExternalWorksheetNames(this.externalFile);
                } else {
                    throw new Error('No external file selected');
                }
            } else {
                sheets = await this.excelIntegration.getCurrentWorksheetNames();
            }
            
            this.setDropdown(sheets);
            this.updateStatus(`${sheets.length} worksheets found${isExternal ? ` in ${this.getFileDisplayName()}` : ''}`);
            
            // Auto-select worksheet if specified in config
            if (this.mappingConfig.worksheet) {
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
                externalFile: this.externalFile,
                cloudFileUrl: this.cloudFileUrl,
                fileType: this.fileType
            };
            
            const result = await loadAndProcessMappings(customParams);
            // this.mappings = {
            //     forward: result.forward || {},
            //     reverse: result.reverse || {},
            //     metadata: result.metadata || null
            // };
            state.mergeMappings(result.forward || {}, result.reverse || {}, result.metadata || null);
            this.mappings = state.getMappings();
            
            this.handleMappingSuccess(result);
            
            // Notify parent
            if (this.onMappingLoaded) {
                this.onMappingLoaded(this.index, this.mappings, result);
            }
            // Collapse the details element
            document.getElementById(this.elementId).open = false;
    
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
        
        // Add this line to show the filename
        const filename = this.externalFile?.name || 'Current Excel file';
        document.getElementById(`${this.elementId}-filename-display`).textContent = ` - ${filename}`;
    }
    handleMappingError(error) {
        this.mappings = { forward: {}, reverse: {}, metadata: null };
        this.updateStatus(error.message, true);
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
    getFileDisplayName() {
        if (this.fileType === 'cloud' && this.cloudFileUrl) {
            return this.parseFileName(this.cloudFileUrl);
        } else if (this.externalFile) {
            return this.externalFile.name;
        }
        return 'Unknown file';
    }
    async openCloudFilePicker() {
        try {
            this.updateStatus('Opening cloud file picker...');
            
            // Use Office.js file picker for cloud files
            if (typeof Office !== 'undefined' && Office.context && Office.context.document) {
                // Check if we're in Excel Online or desktop
                const isOnline = Office.context.host === Office.HostType.Excel && 
                                Office.context.platform === Office.PlatformType.OfficeOnline;
                
                if (isOnline) {
                    // For Excel Online, use the file picker dialog
                    await this.showCloudFilePickerDialog();
                } else {
                    // For Excel Desktop, provide instructions for cloud file access
                    this.showCloudFileInstructions();
                }
            } else {
                throw new Error('Office.js not available');
            }
        } catch (error) {
            this.updateStatus(`Cloud picker error: ${error.message}`, true);
        }
    }

    async showCloudFilePickerDialog() {
        try {
            // Create a dialog for file URL input since direct file picker APIs are limited
            const dialog = document.createElement('div');
            dialog.innerHTML = `
                <div class="cloud-file-dialog" style="padding: 10px; background: white; border: 1px solid #ccc;">
                    <h4>Enter Cloud File URL</h4>
                    <p class="ms-font-xs">Paste the SharePoint/OneDrive URL to your Excel file:</p>
                    <input type="url" id="cloud-url-input" placeholder="https://contoso.sharepoint.com/..." style="width: 100%; margin: 10px 0;" />
                    <div>
                        <button id="cloud-url-ok" class="ms-Button ms-Button--primary">OK</button>
                        <button id="cloud-url-cancel" class="ms-Button">Cancel</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(dialog);
            
            return new Promise((resolve, reject) => {
                document.getElementById('cloud-url-ok').onclick = () => {
                    const url = document.getElementById('cloud-url-input').value.trim();
                    document.body.removeChild(dialog);
                    if (url) {
                        this.setCloudFile(url);
                        resolve(url);
                    } else {
                        reject(new Error('No URL provided'));
                    }
                };
                
                document.getElementById('cloud-url-cancel').onclick = () => {
                    document.body.removeChild(dialog);
                    reject(new Error('Cancelled'));
                };
            });
        } catch (error) {
            this.updateStatus(`Dialog error: ${error.message}`, true);
        }
    }

    showCloudFileInstructions() {
        const message = `For Excel Desktop users:
        
1. Upload your Excel file to OneDrive or SharePoint
2. Get the sharing URL from the cloud
3. Use the URL input option instead`;
        
        this.updateStatus(message);
        this.showCloudFilePickerDialog();
    }

    setLocalFile(file) {
        this.externalFile = file;
        this.cloudFileUrl = null;
        this.fileType = 'local';
        
        document.getElementById(`${this.elementId}-file-path-display`).value = file.name;
        document.getElementById(`${this.elementId}-external-file`).checked = true;
        document.getElementById(`${this.elementId}-external-file-section`)?.classList.remove('hidden');
        document.getElementById(`${this.elementId}-file-type`).textContent = '📁 Local file';
        
        this.updateStatus(`Reading ${file.name}...`);
        this.loadSheets(true);
    }

    setCloudFile(url) {
        this.cloudFileUrl = url;
        this.externalFile = null;
        this.fileType = 'cloud';
        
        const fileName = this.parseFileName(url);
        document.getElementById(`${this.elementId}-file-path-display`).value = url;
        document.getElementById(`${this.elementId}-external-file`).checked = true;
        document.getElementById(`${this.elementId}-external-file-section`)?.classList.remove('hidden');
        document.getElementById(`${this.elementId}-file-type`).textContent = '☁️ Cloud file';
        
        this.updateStatus(`Connected to cloud file: ${fileName}`);
        this.updateStatus('Cloud file sheets will be loaded when processing...');
    }

    getMappings() {
        return this.mappings;
    }
    getConfig() {
        return this.mappingConfig;
    }
}