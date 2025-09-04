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

    // Build HTML using proper string concatenation to avoid prettier breaking it
    const fileNameSpanId = `${this.elementId}-filename-display`;
    const currentFileId = `${this.elementId}-current-file`;
    const externalFileId = `${this.elementId}-external-file`;
    const filePathDisplayId = `${this.elementId}-file-path-display`;
    const filePickerInputId = `${this.elementId}-file-picker-input`;
    const browseButtonId = `${this.elementId}-browse-button`;
    const worksheetDropdownId = `${this.elementId}-worksheet-dropdown`;
    const targetColumnId = `${this.elementId}-target-column`;
    const sourceColumnId = `${this.elementId}-source-column`;
    const loadMappingId = `${this.elementId}-load-mapping`;
    const fileSourceName = `${this.elementId}-file-source`;
    const externalFileSectionId = `${this.elementId}-external-file-section`;

    element.innerHTML = `
            <summary class="ms-font-m">
                Map Config ${this.index + 1}
                <span id="${fileNameSpanId}" style="margin-left: 10px; font-style: italic; color: #666;"></span>
            </summary>
            <div class="form-section first-form-section">
                <div class="radio-group">
                    <label>Excel File:</label>
                    <div>
                        <input type="radio" id="${currentFileId}" name="${fileSourceName}" value="current" checked />
                        <label for="${currentFileId}" class="ms-font-m">This Excel file</label>
                    </div>
                    <div>
                        <input type="radio" id="${externalFileId}" name="${fileSourceName}" value="external" />
                        <label for="${externalFileId}" class="ms-font-m">External Excel file</label>
                    </div>
                </div>
                <div id="${externalFileSectionId}" class="hidden form-section">
                    <div class="file-row">
                        <label for="${filePathDisplayId}" class="ms-font-m">File Path:</label>
                        <input type="text" id="${filePathDisplayId}" placeholder="No file selected" readonly />
                        <input type="file" id="${filePickerInputId}" accept=".xlsx,.xls" class="hidden" />
                        <button id="${browseButtonId}" class="ms-Button">Browse...</button>
                    </div>
                </div>
            </div>
            
            <div class="form-section">
                <label for="${worksheetDropdownId}">Worksheet:</label>
                <select id="${worksheetDropdownId}">
                    <option value="">Select a worksheet...</option>
                </select>
            </div>
            
            <div class="form-section">
                <div class="columns">
                    <div>
                        <label for="${targetColumnId}">Reference Column:</label>
                        <input type="text" id="${targetColumnId}" />
                    </div>
                    <div>
                        <label for="${sourceColumnId}">Alias Column:</label>
                        <input type="text" id="${sourceColumnId}" placeholder="optional" />
                    </div>
                </div>
            </div>
            
            <button id="${loadMappingId}" class="btn-full form-section">
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
    // File source radios
    const currentFileRadio = document.getElementById(`${this.elementId}-current-file`);
    const externalFileRadio = document.getElementById(`${this.elementId}-external-file`);
    const browseButton = document.getElementById(`${this.elementId}-browse-button`);
    const filePickerInput = document.getElementById(`${this.elementId}-file-picker-input`);
    const loadMappingButton = document.getElementById(`${this.elementId}-load-mapping`);

    if (currentFileRadio) {
      currentFileRadio.addEventListener("change", () => {
        document.getElementById(`${this.elementId}-external-file-section`)?.classList.add("hidden");
        this.loadSheets(false);
      });
    }

    if (externalFileRadio) {
      externalFileRadio.addEventListener("change", () => {
        document.getElementById(`${this.elementId}-external-file-section`)?.classList.remove("hidden");
        if (this.externalFile) this.loadSheets(true);
        else this.setDropdown(["Select external file first..."], true);
      });
    }

    if (browseButton) {
      browseButton.addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById(`${this.elementId}-file-picker-input`)?.click();
      });
    }

    if (filePickerInput) {
      filePickerInput.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        this.externalFile = file;
        document.getElementById(`${this.elementId}-file-path-display`).value = file.name;
        document.getElementById(`${this.elementId}-external-file`).checked = true;
        document.getElementById(`${this.elementId}-external-file-section`)?.classList.remove("hidden");

        this.updateStatus(`Reading ${file.name}...`);
        this.loadSheets(true);
      });
    }

    if (loadMappingButton) {
      console.log(`🔵 SETUP_EVENTS: Module ${this.index + 1} - Adding click listener to load mapping button`);
      loadMappingButton.addEventListener("click", (e) => {
        console.log(`🔵 BUTTON_CLICK: Module ${this.index + 1} - Load Mapping Table button clicked`);
        e.preventDefault();
        this.loadMappings();
      });
    } else {
      console.log(
        `🔴 SETUP_EVENTS: Module ${this.index + 1} - Load mapping button NOT FOUND! Element ID: ${
          this.elementId
        }-load-mapping`
      );
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
    console.log(`🔵 LOAD_MAPPINGS: Module ${this.index + 1} - Starting load process`);

    try {
      this.updateStatus("Loading...");

      const customParams = {
        useCurrentFile: document.getElementById(`${this.elementId}-current-file`)?.checked || false,
        sheetName: document.getElementById(`${this.elementId}-worksheet-dropdown`)?.value || "",
        sourceColumn: document.getElementById(`${this.elementId}-source-column`)?.value || null,
        targetColumn: document.getElementById(`${this.elementId}-target-column`)?.value || "",
        externalFile: this.externalFile,
      };

      console.log(`🔵 LOAD_MAPPINGS: Module ${this.index + 1} - Custom params:`, customParams);

      const result = await loadAndProcessMappings(customParams);
      console.log(`🔵 LOAD_MAPPINGS: Module ${this.index + 1} - loadAndProcessMappings returned:`, {
        hasForward: !!result?.forward,
        hasReverse: !!result?.reverse,
        hasMetadata: !!result?.metadata,
        forwardCount: result?.forward ? Object.keys(result.forward).length : 0,
        reverseCount: result?.reverse ? Object.keys(result.reverse).length : 0,
        resultStructure: Object.keys(result || {}),
      });

      // Store mapping source for later combination
      console.log(`🔵 LOAD_MAPPINGS: Module ${this.index + 1} - Calling state.addMappingSource with:`, {
        index: this.index,
        mappingsParam: result,
        resultParam: result,
        configParam: this.mappingConfig,
      });

      // The result object contains forward, reverse, and metadata
      // It IS the mappings object, so we pass it as both mappings and result
      state.addMappingSource(this.index, result, result, this.mappingConfig);
      this.mappings = result;

      console.log(`🔵 LOAD_MAPPINGS: Module ${this.index + 1} - Calling handleMappingSuccess`);
      this.handleMappingSuccess(result);

      // Notify parent (for UI updates only)
      if (this.onMappingLoaded) {
        console.log(`🔵 LOAD_MAPPINGS: Module ${this.index + 1} - Calling onMappingLoaded callback`);
        this.onMappingLoaded(this.index, this.mappings, result);
      }

      // Collapse the details element
      document.getElementById(this.elementId).open = false;
      console.log(`🟢 LOAD_MAPPINGS: Module ${this.index + 1} - Load process completed successfully`);
    } catch (error) {
      console.log(`🔴 LOAD_MAPPINGS: Module ${this.index + 1} - Error:`, error);
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
