// ui-components/mapping-config-module.js
import * as XLSX from "xlsx";
import { loadAndProcessMappings } from "../data-processing/mapping.processor.js";
import { state } from "../shared-services/state.manager.js";
export class MappingConfigModule {
  constructor(mappingConfig, index, onMappingLoaded) {
    this.mappingConfig = mappingConfig;
    this.index = index;
    this.onMappingLoaded = onMappingLoaded;
    this.externalFile = null;
    this.cachedWorkbook = null;
    this.cachedFileName = null;
    this.elementId = `mapping-config-${index}`;
    this.mappings = { forward: {}, reverse: {}, metadata: null };
  }
  createElement() {
    const element = document.createElement("details");
    element.id = this.elementId;
    element.className = "ms-welcome__section mapping-config-module";
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
                        <button id="${this.elementId}-browse-button" class="ms-Button">Browse...</button>
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
    state.setStatus(`LOG: Module ${this.index + 1} init() - starting createElement()...`);
    const element = this.createElement();
    
    if (!element) {
      state.setStatus(`LOG: Module ${this.index + 1} ERROR - createElement() returned null/undefined`, true);
      return null;
    }
    
    state.setStatus(`LOG: Module ${this.index + 1} createElement() success - element ID: ${element.id}, class: ${element.className}`);
    
    if (!container) {
      state.setStatus(`LOG: Module ${this.index + 1} ERROR - container is null/undefined`, true);
      return null;
    }
    
    state.setStatus(`LOG: Module ${this.index + 1} appending to container - current children: ${container.children.length}`);
    container.appendChild(element);
    state.setStatus(`LOG: Module ${this.index + 1} appendChild() done - new children count: ${container.children.length}`);
    
    state.setStatus(`LOG: Module ${this.index + 1} starting setupEvents()...`);
    this.setupEvents();
    state.setStatus(`LOG: Module ${this.index + 1} setupEvents() completed`);
    
    state.setStatus(`LOG: Module ${this.index + 1} starting loadInitialData()...`);
    this.loadInitialData();
    state.setStatus(`LOG: Module ${this.index + 1} loadInitialData() completed`);
    
    state.setStatus(`LOG: Module ${this.index + 1} init() fully completed - returning element`);
    return element;
  }
  setupEvents() {
    state.setStatus(`LOG: Module ${this.index + 1} setupEvents() - checking elements...`);
    
    // File source radios
    const currentFileRadio = document.getElementById(`${this.elementId}-current-file`);
    const externalFileRadio = document.getElementById(`${this.elementId}-external-file`);
    const browseButton = document.getElementById(`${this.elementId}-browse-button`);
    const filePickerInput = document.getElementById(`${this.elementId}-file-picker-input`);
    const loadMappingButton = document.getElementById(`${this.elementId}-load-mapping`);
    
    state.setStatus(`LOG: Module ${this.index + 1} elements - current-file: ${!!currentFileRadio}, external-file: ${!!externalFileRadio}, browse: ${!!browseButton}, picker: ${!!filePickerInput}, load-btn: ${!!loadMappingButton}`);
    
    try {
      if (currentFileRadio) {
        currentFileRadio.addEventListener("change", () => {
          state.setStatus(`LOG: Module ${this.index + 1} current-file radio changed`);
          document.getElementById(`${this.elementId}-external-file-section`)?.classList.add("hidden");
          this.loadSheets(false);
        });
        state.setStatus(`LOG: Module ${this.index + 1} current-file listener added`);
      }

      if (externalFileRadio) {
        externalFileRadio.addEventListener("change", () => {
          state.setStatus(`LOG: Module ${this.index + 1} external-file radio changed`);
          document.getElementById(`${this.elementId}-external-file-section`)?.classList.remove("hidden");
          if (this.externalFile) this.loadSheets(true);
          else this.setDropdown(["Select external file first..."], true);
        });
        state.setStatus(`LOG: Module ${this.index + 1} external-file listener added`);
      }

      if (browseButton) {
        browseButton.addEventListener("click", (e) => {
          state.setStatus(`LOG: Module ${this.index + 1} browse button clicked`);
          e.preventDefault();
          document.getElementById(`${this.elementId}-file-picker-input`)?.click();
        });
        state.setStatus(`LOG: Module ${this.index + 1} browse button listener added`);
      }

      if (filePickerInput) {
        filePickerInput.addEventListener("change", (e) => {
          const file = e.target.files?.[0];
          state.setStatus(`LOG: Module ${this.index + 1} file picker changed - file: ${file?.name || 'none'}`);
          if (!file) return;

          this.externalFile = file;
          document.getElementById(`${this.elementId}-file-path-display`).value = file.name;
          document.getElementById(`${this.elementId}-external-file`).checked = true;
          document.getElementById(`${this.elementId}-external-file-section`)?.classList.remove("hidden");

          this.updateStatus(`Reading ${file.name}...`);
          this.loadSheets(true);
        });
        state.setStatus(`LOG: Module ${this.index + 1} file picker listener added`);
      }
      
      if (loadMappingButton) {
        loadMappingButton.addEventListener("click", () => {
          state.setStatus(`LOG: Module ${this.index + 1} load mapping button clicked`);
          this.loadMappings();
        });
        state.setStatus(`LOG: Module ${this.index + 1} load mapping button listener added`);
      }
      
      state.setStatus(`LOG: Module ${this.index + 1} setupEvents() completed successfully`);
    } catch (eventError) {
      state.setStatus(`LOG: Module ${this.index + 1} ERROR in setupEvents(): ${eventError.message}`, true);
    }
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
      document.getElementById(`${this.elementId}-external-file-section`)?.classList.remove("hidden");
      const fileName = this.parseFileName(this.mappingConfig.mapping_reference);
      document.getElementById(`${this.elementId}-file-path-display`).value = fileName;
      this.updateStatus(`Config expects: ${fileName}`);
      this.setDropdown(["Browse for external file first..."], true);
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
      this.setDropdown(["Select external file first..."], true);
      return;
    }
    try {
      const sheets = isExternal
        ? await this.getExternalWorksheetNames(this.externalFile)
        : await this.getCurrentWorksheetNames();

      this.setDropdown(sheets);
      this.updateStatus(`${sheets.length} worksheets found${isExternal ? ` in ${this.externalFile.name}` : ""}`);

      // Auto-select worksheet if specified in config
      if (this.mappingConfig.worksheet) {
        this.selectWorksheet(this.mappingConfig.worksheet);
      }
    } catch (error) {
      this.setDropdown(["Error loading worksheets"], true);
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
      dropdown.innerHTML =
        '<option value="">Select a worksheet...</option>' +
        sheets.map((name) => `<option value="${name}">${name}</option>`).join("");
      dropdown.disabled = false;
    }
  }
  selectWorksheet(name) {
    const dropdown = document.getElementById(`${this.elementId}-worksheet-dropdown`);
    if (!name || !dropdown) return;

    const optionExists = Array.from(dropdown.options).some((opt) => opt.value === name);
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
        sheetName: document.getElementById(`${this.elementId}-worksheet-dropdown`)?.value || "",
        sourceColumn: document.getElementById(`${this.elementId}-source-column`)?.value || null,
        targetColumn: document.getElementById(`${this.elementId}-target-column`)?.value || "",
        externalFile: this.externalFile,
      };

      const result = await loadAndProcessMappings(customParams);

      // Store mapping source for later combination
      state.addMappingSource(this.index, result, result, this.mappingConfig);
      this.mappings = result;

      this.handleMappingSuccess(result);

      // Notify parent (for UI updates only)
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
    const { validMappings, issues, serverWarning } = result.metadata || {};

    // Create status message
    let message = issues?.length
      ? `✓ ${validMappings} mappings (${issues.length} issues)`
      : `✓ ${validMappings} mappings loaded`;

    if (serverWarning) {
      message += " - Server unavailable";
    }

    // Update local UI status
    this.updateStatus(message, false, "success");

    // Update global status
    state.setStatus(message);

    // Show filename
    const filename = this.externalFile?.name || "Current Excel file";
    document.getElementById(`${this.elementId}-filename-display`).textContent = ` - ${filename}`;
  }
  handleMappingError(error) {
    this.mappings = { forward: {}, reverse: {}, metadata: null };
    this.updateStatus(error.message, true);
  }
  updateStatus(message, isError = false, type = "info") {
    const statusElement = document.getElementById(`${this.elementId}-status`);
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.className = `mapping-status ${type}`;
      if (isError) {
        statusElement.className += " error";
      }
    }
  }
  isExternalFile() {
    const ref = this.mappingConfig.mapping_reference;
    return ref && (ref.includes("/") || ref.includes("\\"));
  }
  parseFileName(path) {
    return path?.split(/[\\/]/).pop();
  }
  getMappings() {
    return this.mappings;
  }
  
  // Inlined Excel integration methods
  async getCurrentWorksheetNames() {
    return await Excel.run(async (context) => {
      const worksheets = context.workbook.worksheets;
      worksheets.load("items/name");
      await context.sync();
      return worksheets.items.map((ws) => ws.name);
    });
  }
  
  async getExternalWorksheetNames(file) {
    const workbook = await this.loadExternalWorkbook(file);
    return workbook.SheetNames;
  }
  
  async loadExternalWorkbook(file) {
    if (this.cachedWorkbook && this.cachedFileName === file.name) {
      return this.cachedWorkbook;
    }
    
    const buffer = await file.arrayBuffer();
    this.cachedWorkbook = XLSX.read(buffer, { type: "array" });
    this.cachedFileName = file.name;
    return this.cachedWorkbook;
  }
}
