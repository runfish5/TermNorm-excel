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
    
    // Pre-generate all DOM IDs to reduce repetition
    this.ids = {
      filenameDisplay: `${this.elementId}-filename-display`,
      currentFile: `${this.elementId}-current-file`,
      externalFile: `${this.elementId}-external-file`,
      filePathDisplay: `${this.elementId}-file-path-display`,
      filePickerInput: `${this.elementId}-file-picker-input`,
      browseButton: `${this.elementId}-browse-button`,
      worksheetDropdown: `${this.elementId}-worksheet-dropdown`,
      targetColumn: `${this.elementId}-target-column`,
      sourceColumn: `${this.elementId}-source-column`,
      loadMapping: `${this.elementId}-load-mapping`,
      fileSource: `${this.elementId}-file-source`,
      externalFileSection: `${this.elementId}-external-file-section`
    };
  }
  createElement() {
    const element = document.createElement("details");
    element.id = this.elementId;
    element.className = "ms-welcome__section mapping-config-module";
    element.open = true;

    const { ids } = this;

    element.innerHTML = `
            <summary class="ms-font-m">
                Map Config ${this.index + 1}
                <span id="${ids.filenameDisplay}" style="margin-left: 10px; font-style: italic; color: #666;"></span>
            </summary>
            <div class="form-section first-form-section">
                <div class="radio-group">
                    <label>Excel File:</label>
                    <div>
                        <input type="radio" id="${ids.currentFile}" name="${ids.fileSource}" value="current" checked />
                        <label for="${ids.currentFile}" class="ms-font-m">This Excel file</label>
                    </div>
                    <div>
                        <input type="radio" id="${ids.externalFile}" name="${ids.fileSource}" value="external" />
                        <label for="${ids.externalFile}" class="ms-font-m">External Excel file</label>
                    </div>
                </div>
                <div id="${ids.externalFileSection}" class="hidden form-section">
                    <div class="file-row">
                        <label for="${ids.filePathDisplay}" class="ms-font-m">File Path:</label>
                        <input type="text" id="${ids.filePathDisplay}" placeholder="No file selected" readonly />
                        <input type="file" id="${ids.filePickerInput}" accept=".xlsx,.xls" class="hidden" />
                        <button id="${ids.browseButton}" class="ms-Button">Browse...</button>
                    </div>
                </div>
            </div>
            
            <div class="form-section">
                <label for="${ids.worksheetDropdown}">Worksheet:</label>
                <select id="${ids.worksheetDropdown}">
                    <option value="">Select a worksheet...</option>
                </select>
            </div>
            
            <div class="form-section">
                <div class="columns">
                    <div>
                        <label for="${ids.targetColumn}">Reference Column:</label>
                        <input type="text" id="${ids.targetColumn}" />
                    </div>
                    <div>
                        <label for="${ids.sourceColumn}">Alias Column:</label>
                        <input type="text" id="${ids.sourceColumn}" placeholder="optional" />
                    </div>
                </div>
            </div>
            
            <button id="${ids.loadMapping}" class="btn-full form-section">
                Load Mapping Table ${this.index + 1}
            </button>
        `;

    return element;
  }
  init(container) {
    if (!container) {
      throw new Error(`Module ${this.index + 1}: Container is required`);
    }

    const element = this.createElement();
    if (!element) {
      throw new Error(`Module ${this.index + 1}: Failed to create element`);
    }

    container.appendChild(element);
    this.setupEvents();
    this.loadInitialData();

    return element;
  }
  setupEvents() {
    const { ids } = this;
    
    // File source radios
    const currentFileRadio = document.getElementById(ids.currentFile);
    const externalFileRadio = document.getElementById(ids.externalFile);
    const browseButton = document.getElementById(ids.browseButton);
    const filePickerInput = document.getElementById(ids.filePickerInput);
    const loadMappingButton = document.getElementById(ids.loadMapping);

    if (currentFileRadio) {
      currentFileRadio.addEventListener("change", () => {
        document.getElementById(ids.externalFileSection)?.classList.add("hidden");
        this.loadSheets(false);
      });
    }

    if (externalFileRadio) {
      externalFileRadio.addEventListener("change", () => {
        document.getElementById(ids.externalFileSection)?.classList.remove("hidden");
        if (this.externalFile) this.loadSheets(true);
        else this.setDropdown(["Select external file first..."], true);
      });
    }

    if (browseButton) {
      browseButton.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById(ids.filePickerInput)?.click();
      });
    }

    if (filePickerInput) {
      filePickerInput.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        this.externalFile = file;
        document.getElementById(ids.filePathDisplay).value = file.name;
        document.getElementById(ids.externalFile).checked = true;
        document.getElementById(ids.externalFileSection)?.classList.remove("hidden");

        this.updateStatus(`Reading ${file.name}...`);
        this.loadSheets(true);
      });
    }

    if (loadMappingButton) {
      loadMappingButton.addEventListener("click", (e) => {
        e.preventDefault();
        this.loadMappings();
      });
    }
  }
  loadInitialData() {
    const { ids } = this;
    
    // Pre-fill form with config data
    if (this.mappingConfig.source_column) {
      document.getElementById(ids.sourceColumn).value = this.mappingConfig.source_column;
    }
    if (this.mappingConfig.target_column) {
      document.getElementById(ids.targetColumn).value = this.mappingConfig.target_column;
    }

    // Determine if external file
    const isExternal = this.isExternalFile();
    if (isExternal) {
      document.getElementById(ids.externalFile).checked = true;
      document.getElementById(ids.externalFileSection)?.classList.remove("hidden");
      const fileName = this.parseFileName(this.mappingConfig.mapping_reference);
      document.getElementById(ids.filePathDisplay).value = fileName;
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
    const dropdown = document.getElementById(this.ids.worksheetDropdown);
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
    const dropdown = document.getElementById(this.ids.worksheetDropdown);
    if (!name || !dropdown) return;

    const optionExists = Array.from(dropdown.options).some((opt) => opt.value === name);
    if (optionExists) {
      dropdown.value = name;
      this.updateStatus(`Selected: ${name}`);
    }
  }
  async loadMappings() {
    const { ids } = this;
    
    try {
      this.updateStatus("Loading...");

      const customParams = {
        useCurrentFile: document.getElementById(ids.currentFile)?.checked || false,
        sheetName: document.getElementById(ids.worksheetDropdown)?.value || "",
        sourceColumn: document.getElementById(ids.sourceColumn)?.value || null,
        targetColumn: document.getElementById(ids.targetColumn)?.value || "",
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
    document.getElementById(this.ids.filenameDisplay).textContent = ` - ${filename}`;
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
