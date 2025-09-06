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
    this.elementId = `mapping-config-${index}`;
    this.mappings = { forward: {}, reverse: {}, metadata: null };
  }
  createTemplate() {
    return `
      <summary class="ms-font-m">
        Map Config ${this.index + 1}
        <span class="filename-display" style="margin-left: 10px; font-style: italic; color: #666;"></span>
      </summary>
      <div class="form-section first-form-section">
        <div class="radio-group">
          <label>Excel File:</label>
          <div>
            <input type="radio" class="current-file" name="file-source" value="current" checked />
            <label class="ms-font-m">This Excel file</label>
          </div>
          <div>
            <input type="radio" class="external-file" name="file-source" value="external" />
            <label class="ms-font-m">External Excel file</label>
          </div>
        </div>
        <div class="external-file-section hidden form-section">
          <div class="file-row">
            <label class="ms-font-m">File Path:</label>
            <input type="text" class="file-path-display" placeholder="No file selected" readonly />
            <input type="file" class="file-picker-input" accept=".xlsx,.xls" style="display: none" />
            <button class="browse-button ms-Button">Browse...</button>
          </div>
        </div>
      </div>
      <div class="form-section">
        <label>Worksheet:</label>
        <select class="worksheet-dropdown">
          <option value="">Select a worksheet...</option>
        </select>
      </div>
      <div class="form-section">
        <div class="columns">
          <div>
            <label>Reference Column:</label>
            <input type="text" class="target-column" />
          </div>
          <div>
            <label>Alias Column:</label>
            <input type="text" class="source-column" placeholder="optional" />
          </div>
        </div>
      </div>
      <button class="load-mapping btn-full form-section">
        Load Mapping Table ${this.index + 1}
      </button>
    `;
  }

  createElement() {
    const element = document.createElement("details");
    element.id = this.elementId;
    element.className = "ms-welcome__section mapping-config-module";
    element.open = true;
    element.innerHTML = this.createTemplate();
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
    const element = document.getElementById(this.elementId);
    
    element.addEventListener("click", (e) => {
      if (e.target.matches(".browse-button")) {
        e.preventDefault();
        element.querySelector(".file-picker-input").click();
      }
      if (e.target.matches(".load-mapping")) {
        e.preventDefault();
        this.loadMappings();
      }
    });
    
    element.addEventListener("change", (e) => {
      if (e.target.matches(".current-file")) {
        element.querySelector(".external-file-section").classList.add("hidden");
        this.loadSheets(false);
      }
      if (e.target.matches(".external-file")) {
        element.querySelector(".external-file-section").classList.remove("hidden");
        if (this.externalFile) this.loadSheets(true);
        else this.setDropdown(["Select external file first..."], true);
      }
      if (e.target.matches(".file-picker-input")) {
        const file = e.target.files?.[0];
        if (file) {
          this.externalFile = file;
          element.querySelector(".file-path-display").value = file.name;
          element.querySelector(".external-file").checked = true;
          element.querySelector(".external-file-section").classList.remove("hidden");
          state.setStatus(`Reading ${file.name}...`);
          this.loadSheets(true);
        }
      }
    });
  }
  loadInitialData() {
    const element = document.getElementById(this.elementId);
    
    if (this.mappingConfig.source_column) {
      element.querySelector(".source-column").value = this.mappingConfig.source_column;
    }
    if (this.mappingConfig.target_column) {
      element.querySelector(".target-column").value = this.mappingConfig.target_column;
    }

    const isExternal = this.mappingConfig.mapping_reference?.includes("/") || 
                      this.mappingConfig.mapping_reference?.includes("\\");
    
    if (isExternal) {
      element.querySelector(".external-file").checked = true;
      element.querySelector(".external-file-section").classList.remove("hidden");
      const fileName = this.mappingConfig.mapping_reference?.split(/[\\/]/).pop();
      element.querySelector(".file-path-display").value = fileName;
      state.setStatus(`Config expects: ${fileName}`);
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
        ? await this.getWorksheetNames(this.externalFile)
        : await this.getWorksheetNames();

      this.setDropdown(sheets);
      state.setStatus(`${sheets.length} worksheets found${isExternal ? ` in ${this.externalFile.name}` : ""}`);

      if (this.mappingConfig.worksheet) {
        this.selectWorksheet(this.mappingConfig.worksheet);
      }
    } catch (error) {
      this.setDropdown(["Error loading worksheets"], true);
      state.setStatus(`Error: ${error.message}`);
    }
  }
  setDropdown(sheets, disabled = false) {
    const dropdown = document.getElementById(this.elementId).querySelector(".worksheet-dropdown");
    if (!dropdown) return;

    dropdown.innerHTML = disabled 
      ? `<option value="">${sheets[0]}</option>`
      : '<option value="">Select a worksheet...</option>' + 
        sheets.map(name => `<option value="${name}">${name}</option>`).join("");
    dropdown.disabled = disabled;
  }
  selectWorksheet(name) {
    const dropdown = document.getElementById(this.elementId).querySelector(".worksheet-dropdown");
    if (name && dropdown && Array.from(dropdown.options).some(opt => opt.value === name)) {
      dropdown.value = name;
      state.setStatus(`Selected: ${name}`);
    }
  }
  async loadMappings() {
    const element = document.getElementById(this.elementId);
    
    try {
      state.setStatus("Loading...");

      const customParams = {
        useCurrentFile: element.querySelector(".current-file").checked,
        sheetName: element.querySelector(".worksheet-dropdown").value,
        sourceColumn: element.querySelector(".source-column").value || null,
        targetColumn: element.querySelector(".target-column").value,
        externalFile: this.externalFile,
      };

      const result = await loadAndProcessMappings(customParams);
      state.addMappingSource(this.index, result, result, this.mappingConfig);
      this.mappings = result;

      this.handleMappingSuccess(result);
      this.onMappingLoaded?.(this.index, this.mappings, result);
      element.open = false;
    } catch (error) {
      this.mappings = { forward: {}, reverse: {}, metadata: null };
      state.setStatus(error.message);
    }
  }
  handleMappingSuccess(result) {
    const { validMappings, issues, serverWarning } = result.metadata || {};
    
    let message = issues?.length
      ? `✓ ${validMappings} mappings (${issues.length} issues)`
      : `✓ ${validMappings} mappings loaded`;
    
    if (serverWarning) message += " - Server unavailable";
    
    state.setStatus(message);
    
    const filename = this.externalFile?.name || "Current Excel file";
    document.getElementById(this.elementId).querySelector(".filename-display").textContent = ` - ${filename}`;
  }
  getMappings() {
    return this.mappings;
  }

  async getWorksheetNames(file = null) {
    if (file) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      return workbook.SheetNames;
    }
    
    return await Excel.run(async (context) => {
      const worksheets = context.workbook.worksheets;
      worksheets.load("items/name");
      await context.sync();
      return worksheets.items.map(ws => ws.name);
    });
  }
}
