import * as XLSX from "xlsx";
import { loadAndProcessMappings } from "../data-processing/mapping.processor.js";
import { getStateValue } from "../core/state-actions.js";
import { loadMappingSource } from "../shared-services/state-manager.js";
import { showMessage } from "../utils/error-display.js";

export function createMappingConfigHTML(config, i) {
  return `<summary class="ms-font-m">Map Config ${i + 1}<span class="filename-display" style="margin-left:10px;font-style:italic;color:#666"></span></summary>
<div class="form-section first-form-section"><div class="radio-group"><label>Excel File:</label>
<div><input type="radio" class="current-file" name="file-source-${i}" value="current" checked /><label class="ms-font-m">This Excel file</label></div>
<div><input type="radio" class="external-file" name="file-source-${i}" value="external" /><label class="ms-font-m">External Excel file</label></div></div>
<div class="external-file-section hidden form-section"><div class="file-row"><label class="ms-font-m">File Path:</label>
<input type="text" class="file-path-display" placeholder="No file selected" readonly />
<input type="file" class="file-picker-input" accept=".xlsx,.xls" style="display:none" />
<button class="browse-button ms-Button">Browse...</button></div></div></div>
<div class="form-section"><label>Worksheet:</label><select class="worksheet-dropdown"><option value="">Select a worksheet...</option></select></div>
<div class="form-section"><div class="columns"><div><label>Reference Column:</label><input type="text" class="target-column" /></div>
<div><label>Alias Column:</label><input type="text" class="source-column" placeholder="optional" /></div></div></div>
<button class="load-mapping btn-full form-section">Load Mapping Table ${i + 1}</button>`;
}

export function setupMappingConfigEvents(el, config, index, onLoaded) {
  let externalFile = null, mappings = { forward: {}, reverse: {}, metadata: null };
  const $ = s => el.querySelector(s);

  const setDropdown = (sheets, disabled = false) => {
    const dd = $(".worksheet-dropdown");
    if (!dd) return;
    dd.innerHTML = disabled ? `<option value="">${sheets[0]}</option>` : '<option value="">Select...</option>' + sheets.map(n => `<option value="${n}">${n}</option>`).join("");
    dd.disabled = disabled;
  };

  const loadSheets = async (isExt = false) => {
    if (isExt && !externalFile) return setDropdown(["Select external file first..."], true);
    try {
      const sheets = await getWorksheetNames(isExt ? externalFile : null);
      setDropdown(sheets);
      showMessage(`${sheets.length} worksheets${isExt ? ` in ${externalFile.name}` : ""}`);
      if (config.worksheet) {
        const dd = $(".worksheet-dropdown");
        if (dd && [...dd.options].some(o => o.value === config.worksheet)) { dd.value = config.worksheet; showMessage(`Selected: ${config.worksheet}`); }
      }
    } catch (e) { setDropdown(["Error loading"], true); showMessage(`Error: ${e.message}`, "error"); }
  };

  el.addEventListener("click", e => {
    if (e.target.matches(".browse-button")) { e.preventDefault(); $(".file-picker-input").click(); }
    if (e.target.matches(".load-mapping")) { e.preventDefault(); loadMappings(); }
  });

  el.addEventListener("change", e => {
    if (e.target.matches(".current-file")) { $(".external-file-section").classList.add("hidden"); loadSheets(false); }
    if (e.target.matches(".external-file")) { $(".external-file-section").classList.remove("hidden"); externalFile ? loadSheets(true) : setDropdown(["Select external file first..."], true); }
    if (e.target.matches(".file-picker-input") && e.target.files?.[0]) {
      externalFile = e.target.files[0];
      $(".file-path-display").value = externalFile.name;
      $(".external-file").checked = true;
      $(".external-file-section").classList.remove("hidden");
      showMessage(`Reading ${externalFile.name}...`);
      loadSheets(true);
    }
  });

  async function loadMappings() {
    try {
      const params = { useCurrentFile: $(".current-file").checked, sheetName: $(".worksheet-dropdown").value, sourceColumn: $(".source-column").value || null, targetColumn: $(".target-column").value, externalFile };
      await loadMappingSource(index, loadAndProcessMappings, params);
      mappings = (getStateValue('mappings.sources') || {})[index]?.data || { forward: {}, reverse: {}, metadata: null };
      const { validMappings, issues, serverWarning } = mappings.metadata || {};
      showMessage(`✓ ${validMappings} mappings${issues?.length ? ` (${issues.length} issues)` : ""}${serverWarning ? " - Server unavailable" : ""}`);
      $(".filename-display").textContent = ` - ${externalFile?.name || "Current file"}`;
      onLoaded?.(index, mappings, mappings);
      el.open = false;
    } catch (e) { mappings = { forward: {}, reverse: {}, metadata: null }; showMessage(e.message, "error"); }
  }

  async function getWorksheetNames(file) {
    if (file) return XLSX.read(await file.arrayBuffer(), { type: "array" }).SheetNames;
    return Excel.run(async ctx => { const ws = ctx.workbook.worksheets; ws.load("items/name"); await ctx.sync(); return ws.items.map(w => w.name); });
  }

  return { getMappings: () => mappings };
}

export function loadMappingConfigData(el, config) {
  const $ = s => el.querySelector(s);
  if (config.source_column) $(".source-column").value = config.source_column;
  if (config.target_column) $(".target-column").value = config.target_column;
  const isExt = config.mapping_reference?.includes("/") || config.mapping_reference?.includes("\\");
  if (isExt) {
    $(".external-file").checked = true;
    $(".external-file-section").classList.remove("hidden");
    const name = config.mapping_reference?.split(/[\\/]/).pop();
    $(".file-path-display").value = name;
    showMessage(`Config expects: ${name}`);
  }
}
