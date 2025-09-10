// ui-components/mapping-config-functions.js
import * as XLSX from "xlsx";
import { loadAndProcessMappings } from "../data-processing/mapping.processor.js";
import { state, setStatus, addMappingSource } from "../shared-services/state.manager.js";

export function createMappingConfigHTML(mappingConfig, index) {
  return `
    <summary class="ms-font-m">
      Map Config ${index + 1}
      <span class="filename-display" style="margin-left: 10px; font-style: italic; color: #666;"></span>
    </summary>
    <div class="form-section first-form-section">
      <div class="radio-group">
        <label>Excel File:</label>
        <div>
          <input type="radio" class="current-file" name="file-source-${index}" value="current" checked />
          <label class="ms-font-m">This Excel file</label>
        </div>
        <div>
          <input type="radio" class="external-file" name="file-source-${index}" value="external" />
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
      Load Mapping Table ${index + 1}
    </button>
  `;
}

export function setupMappingConfigEvents(element, mappingConfig, index, onMappingLoaded) {
  let externalFile = null;
  let mappings = { forward: {}, reverse: {}, metadata: null };

  element.addEventListener("click", (e) => {
    if (e.target.matches(".browse-button")) {
      e.preventDefault();
      element.querySelector(".file-picker-input").click();
    }
    if (e.target.matches(".load-mapping")) {
      e.preventDefault();
      loadMappings();
    }
  });

  element.addEventListener("change", (e) => {
    if (e.target.matches(".current-file")) {
      element.querySelector(".external-file-section").classList.add("hidden");
      loadSheets(false);
    }
    if (e.target.matches(".external-file")) {
      element.querySelector(".external-file-section").classList.remove("hidden");
      if (externalFile) loadSheets(true);
      else setDropdown(["Select external file first..."], true);
    }
    if (e.target.matches(".file-picker-input")) {
      const file = e.target.files?.[0];
      if (file) {
        externalFile = file;
        element.querySelector(".file-path-display").value = file.name;
        element.querySelector(".external-file").checked = true;
        element.querySelector(".external-file-section").classList.remove("hidden");
        setStatus(`Reading ${file.name}...`);
        loadSheets(true);
      }
    }
  });

  async function loadSheets(isExternal = false) {
    if (isExternal && !externalFile) {
      setDropdown(["Select external file first..."], true);
      return;
    }

    try {
      const sheets = isExternal ? await getWorksheetNames(externalFile) : await getWorksheetNames();

      setDropdown(sheets);
      setStatus(`${sheets.length} worksheets found${isExternal ? ` in ${externalFile.name}` : ""}`);

      if (mappingConfig.worksheet) {
        selectWorksheet(mappingConfig.worksheet);
      }
    } catch (error) {
      setDropdown(["Error loading worksheets"], true);
      setStatus(`Error: ${error.message}`);
    }
  }

  function setDropdown(sheets, disabled = false) {
    const dropdown = element.querySelector(".worksheet-dropdown");
    if (!dropdown) return;

    dropdown.innerHTML = disabled
      ? `<option value="">${sheets[0]}</option>`
      : '<option value="">Select a worksheet...</option>' +
        sheets.map((name) => `<option value="${name}">${name}</option>`).join("");
    dropdown.disabled = disabled;
  }

  function selectWorksheet(name) {
    const dropdown = element.querySelector(".worksheet-dropdown");
    if (name && dropdown && Array.from(dropdown.options).some((opt) => opt.value === name)) {
      dropdown.value = name;
      setStatus(`Selected: ${name}`);
    }
  }

  async function loadMappings() {
    // Check server status before proceeding
    const isServerOnline = state.server.online;
    if (!isServerOnline) {
      const errorMessage =
        "❌ Server offline - Mapping table requires backend server to store Excel terminology for AI matching. Please start the backend server and refresh connection.";
      setStatus(errorMessage, true);
      return;
    }

    try {
      setStatus("Loading...");

      const customParams = {
        useCurrentFile: element.querySelector(".current-file").checked,
        sheetName: element.querySelector(".worksheet-dropdown").value,
        sourceColumn: element.querySelector(".source-column").value || null,
        targetColumn: element.querySelector(".target-column").value,
        externalFile: externalFile,
      };

      const result = await loadAndProcessMappings(customParams);
      addMappingSource(index, result, result, mappingConfig);
      mappings = result;

      handleMappingSuccess(result);
      onMappingLoaded?.(index, mappings, result);
      element.open = false;
    } catch (error) {
      mappings = { forward: {}, reverse: {}, metadata: null };
      setStatus(error.message, true);
    }
  }

  function handleMappingSuccess(result) {
    const { validMappings, issues, serverWarning } = result.metadata || {};

    let message = issues?.length
      ? `✓ ${validMappings} mappings (${issues.length} issues)`
      : `✓ ${validMappings} mappings loaded`;

    if (serverWarning) message += " - Server unavailable";

    setStatus(message);

    const filename = externalFile?.name || "Current Excel file";
    element.querySelector(".filename-display").textContent = ` - ${filename}`;
  }

  async function getWorksheetNames(file = null) {
    if (file) {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      return workbook.SheetNames;
    }

    return await Excel.run(async (context) => {
      const worksheets = context.workbook.worksheets;
      worksheets.load("items/name");
      await context.sync();
      return worksheets.items.map((ws) => ws.name);
    });
  }

  return { getMappings: () => mappings };
}

export function loadMappingConfigData(element, mappingConfig) {
  if (mappingConfig.source_column) {
    element.querySelector(".source-column").value = mappingConfig.source_column;
  }
  if (mappingConfig.target_column) {
    element.querySelector(".target-column").value = mappingConfig.target_column;
  }

  const isExternal = mappingConfig.mapping_reference?.includes("/") || mappingConfig.mapping_reference?.includes("\\");

  if (isExternal) {
    element.querySelector(".external-file").checked = true;
    element.querySelector(".external-file-section").classList.remove("hidden");
    const fileName = mappingConfig.mapping_reference?.split(/[\\/]/).pop();
    element.querySelector(".file-path-display").value = fileName;
    setStatus(`Config expects: ${fileName}`);
    // setDropdown will be handled by event system
  } else {
    // loadSheets will be handled by event system
  }
}
