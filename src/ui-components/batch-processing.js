import { showMessage } from "../utils/error-display.js";
import { apiPost } from "../utils/api-fetch.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { getStateValue } from "../core/state-actions.js";
import { getRelevanceColor } from "../utils/app-utilities.js";

let selectedRange = null, isProcessing = false;
const $ = id => document.getElementById(id);

export function init() {
  const view = $("results-view");
  if (!view) return false;
  const section = Object.assign(document.createElement("div"), { id: "batch-processing-section", className: "card card-lg card-muted" });
  section.innerHTML = `
    <details class="card batch-collapsible">
      <summary class="panel-header panel-header-collapsible batch-header">Batch Processing</summary>
      <div class="batch-content">
        <p class="batch-description">Select a range of cells in Excel, provide optional context, and process them all at once.</p>
        <button id="select-range-btn" class="ms-Button ms-Button--primary">
          <span class="ms-Button-label">Select Range in Excel</span>
        </button>
        <div id="range-display" class="range-display hidden">
          <span class="range-label">Selected:</span>
          <span id="range-address" class="range-address">-</span>
          <span id="range-count" class="range-count">0 cells</span>
        </div>
        <div class="context-input-section">
          <label for="batch-context">Context Message (optional):</label>
          <textarea id="batch-context" class="input input-md input-full input-textarea" placeholder="Provide additional context..." rows="3"></textarea>
        </div>
        <div class="batch-actions">
          <button id="batch-process-btn" class="ms-Button ms-Button--primary" disabled>
            <span class="ms-Button-label">Process Batch</span>
          </button>
          <button id="cancel-batch-btn" class="ms-Button ms-Button--default">
            <span class="ms-Button-label">Clear</span>
          </button>
        </div>
        <div id="batch-progress" class="batch-progress hidden">
          <div class="progress-bar">
            <div class="progress-fill" style="width:0%"></div>
          </div>
          <div class="progress-text">Processing: 0 / 0</div>
        </div>
      </div>
    </details>`;
  view.appendChild(section);
  $("select-range-btn")?.addEventListener("click", selectRange);
  $("batch-process-btn")?.addEventListener("click", processBatch);
  $("cancel-batch-btn")?.addEventListener("click", cancelBatch);
  return true;
}

async function selectRange() {
  try {
    await Excel.run(async (ctx) => {
      const r = ctx.workbook.getSelectedRange();
      r.load("address, rowCount, columnCount, values, rowIndex, columnIndex");
      await ctx.sync();
      selectedRange = { address: r.address, rowCount: r.rowCount, columnCount: r.columnCount, values: r.values, rowIndex: r.rowIndex, columnIndex: r.columnIndex };
      $("range-display").classList.remove("hidden");
      $("range-address").textContent = r.address;
      $("range-count").textContent = `${r.rowCount} rows × ${r.columnCount} cols`;
      $("batch-process-btn").disabled = false;
      showMessage(`Selected: ${r.address}`);
    });
  } catch (e) { showMessage(`Select failed: ${e.message}`, "error"); }
}

async function processBatch() {
  if (!selectedRange) return showMessage("No range selected", "error");
  if (!getStateValue('mappings.loaded')) return showMessage("Mappings not loaded", "error");
  if (isProcessing) return showMessage("Already processing", "error");

  const values = selectedRange.values.flat().filter(v => v && String(v).trim());
  if (!values.length) return showMessage("No values in range", "error");
  if (values.length > 100) return showMessage("Max 100 items", "error");

  isProcessing = true;
  ["batch-process-btn", "select-range-btn"].forEach(id => $(id).disabled = true);
  $("batch-progress").classList.remove("hidden");

  try {
    const results = await batchProcessWithProgress(values, $("batch-context").value.trim());
    await writeResultsToExcel(results);
    showMessage(`Batch complete: ${results.length} items`);
  } catch (e) { showMessage(`Batch failed: ${e.message}`, "error"); }
  finally {
    isProcessing = false;
    ["batch-process-btn", "select-range-btn"].forEach(id => $(id).disabled = false);
    $("batch-progress").classList.add("hidden");
  }
}

async function batchProcessWithProgress(values, context) {
  const results = [];
  for (let i = 0; i < values.length; i++) {
    const value = String(values[i]).trim();
    document.querySelector(".progress-fill").style.width = `${Math.round(((i + 1) / values.length) * 100)}%`;
    document.querySelector(".progress-text").textContent = `Processing: ${i + 1} / ${values.length}`;
    try {
      const r = await apiPost(`${getHost()}/batch-process-single`, { query: value, context }, getHeaders());
      results.push(r?.status === "success" && r.data ? { source: value, target: r.data.target || "No match", confidence: r.data.confidence || 0 } : { source: value, target: r?.message || "API error", confidence: 0 });
    } catch (e) { results.push({ source: value, target: `Error: ${e.message}`, confidence: 0 }); }
  }
  return results;
}

async function writeResultsToExcel(results) {
  await Excel.run(async (ctx) => {
    ctx.runtime.enableEvents = false;
    const ws = ctx.workbook.worksheets.getActiveWorksheet(), col = selectedRange.columnIndex + selectedRange.columnCount;
    results.forEach((r, i) => { const c = ws.getRangeByIndexes(selectedRange.rowIndex + i, col, 1, 1); c.values = [[r.target]]; c.format.fill.color = getRelevanceColor(r.confidence); });
    await ctx.sync();
    ctx.runtime.enableEvents = true;
  });
}

function cancelBatch() {
  selectedRange = null;
  $("range-display").classList.add("hidden");
  $("batch-context").value = "";
  $("batch-process-btn").disabled = true;
  showMessage("Selection cleared");
}
