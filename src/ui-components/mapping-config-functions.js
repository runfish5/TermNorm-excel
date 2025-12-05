// ui-components/mapping-config-functions.js
import * as XLSX from "xlsx";
import { loadAndProcessMappings } from "../data-processing/mapping.processor.js";
import { getStateValue } from "../core/state-actions.js";
import { loadMappingSource } from "../shared-services/state-machine.manager.js";
import { showMessage } from "../utils/error-display.js";

export function createMappingConfigHTML(mappingConfig, index) {
  return `
    <summary class="ms-font-m">Map Config ${index + 1}<span class="filename-display" style="margin-left: 10px; font-style: italic; color: #666;"></span></summary>
    <div class="form-section first-form-section">
      <div class="radio-group">
        <label>Excel File:</label>
        <div><input type="radio" class="current-file" name="file-source-${index}" value="current" checked /><label class="ms-font-m">This Excel file</label></div>
        <div><input type="radio" class="external-file" name="file-source-${index}" value="external" /><label class="ms-font-m">External Excel file</label></div>
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
    <div class="form-section"><label>Worksheet:</label><select class="worksheet-dropdown"><option value="">Select a worksheet...</option></select></div>
    <div class="form-section">
      <div class="columns">
        <div><label>Reference Column:</label><input type="text" class="target-column" /></div>
        <div><label>Alias Column:</label><input type="text" class="source-column" placeholder="optional" /></div>
      </div>
    </div>
    <button class="load-mapping btn-full form-section">Load Mapping Table ${index + 1}</button>`;
}

export function setupMappingConfigEvents(element, mappingConfig, index, onMappingLoaded) {
  let externalFile = null, mappings = { forward: {}, reverse: {}, metadata: null };

  const setDropdown = (sheets, disabled = false) => {
    const dropdown = element.querySelector(".worksheet-dropdown");
    if (!dropdown) return;
    dropdown.innerHTML = disabled ? `<option value="">${sheets[0]}</option>` : '<option value="">Select a worksheet...</option>' + sheets.map((n) => `<option value="${n}">${n}</option>`).join("");
    dropdown.disabled = disabled;
  };

  const loadSheets = async (isExternal = false) => {
    if (isExternal && !externalFile) return setDropdown(["Select external file first..."], true);
    try {
      const sheets = isExternal ? await getWorksheetNames(externalFile) : await getWorksheetNames();
      setDropdown(sheets);
      showMessage(`${sheets.length} worksheets found${isExternal ? ` in ${externalFile.name}` : ""}`);
      if (mappingConfig.worksheet) {
        const dropdown = element.querySelector(".worksheet-dropdown");
        if (dropdown && Array.from(dropdown.options).some((o) => o.value === mappingConfig.worksheet)) {
          dropdown.value = mappingConfig.worksheet;
          showMessage(`Selected: ${mappingConfig.worksheet}`);
        }
      }
    } catch (error) {
      setDropdown(["Error loading worksheets"], true);
      showMessage(`Error: ${error.message}`, "error");
    }
  };

  element.addEventListener("click", (e) => {
    if (e.target.matches(".browse-button")) { e.preventDefault(); element.querySelector(".file-picker-input").click(); }
    if (e.target.matches(".load-mapping")) { e.preventDefault(); loadMappings(); }
  });

  element.addEventListener("change", (e) => {
    if (e.target.matches(".current-file")) { element.querySelector(".external-file-section").classList.add("hidden"); loadSheets(false); }
    if (e.target.matches(".external-file")) {
      element.querySelector(".external-file-section").classList.remove("hidden");
      externalFile ? loadSheets(true) : setDropdown(["Select external file first..."], true);
    }
    if (e.target.matches(".file-picker-input")) {
      const file = e.target.files?.[0];
      if (file) {
        externalFile = file;
        element.querySelector(".file-path-display").value = file.name;
        element.querySelector(".external-file").checked = true;
        element.querySelector(".external-file-section").classList.remove("hidden");
        showMessage(`Reading ${file.name}...`);
        loadSheets(true);
      }
    }
  });

  async function loadMappings() {
    try {
      const customParams = {
        useCurrentFile: element.querySelector(".current-file").checked,
        sheetName: element.querySelector(".worksheet-dropdown").value,
        sourceColumn: element.querySelector(".source-column").value || null,
        targetColumn: element.querySelector(".target-column").value,
        externalFile,
      };

      await loadMappingSource(index, loadAndProcessMappings, customParams);
      mappings = (getStateValue('mappings.sources') || {})[index]?.data || { forward: {}, reverse: {}, metadata: null };

      const { validMappings, issues, serverWarning } = mappings.metadata || {};
      let msg = issues?.length ? `✓ ${validMappings} mappings (${issues.length} issues)` : `✓ ${validMappings} mappings loaded`;
      if (serverWarning) msg += " - Server unavailable";
      showMessage(msg);
      element.querySelector(".filename-display").textContent = ` - ${externalFile?.name || "Current Excel file"}`;

      onMappingLoaded?.(index, mappings, mappings);
      element.open = false;
    } catch (error) {
      mappings = { forward: {}, reverse: {}, metadata: null };
      showMessage(error.message, "error");
    }
  }

  async function getWorksheetNames(file = null) {
    if (file) {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      return workbook.SheetNames;
    }
    return await Excel.run(async (ctx) => {
      const worksheets = ctx.workbook.worksheets;
      worksheets.load("items/name");
      await ctx.sync();
      return worksheets.items.map((ws) => ws.name);
    });
  }

  return { getMappings: () => mappings };
}

export function loadMappingConfigData(element, mappingConfig) {
  if (mappingConfig.source_column) element.querySelector(".source-column").value = mappingConfig.source_column;
  if (mappingConfig.target_column) element.querySelector(".target-column").value = mappingConfig.target_column;

  const isExternal = mappingConfig.mapping_reference?.includes("/") || mappingConfig.mapping_reference?.includes("\\");
  if (isExternal) {
    element.querySelector(".external-file").checked = true;
    element.querySelector(".external-file-section").classList.remove("hidden");
    const fileName = mappingConfig.mapping_reference?.split(/[\\/]/).pop();
    element.querySelector(".file-path-display").value = fileName;
    showMessage(`Config expects: ${fileName}`);
  }
}
