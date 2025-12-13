import { showMessage } from "../utils/error-display.js";
import { apiPost } from "../utils/api-fetch.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { getStateValue } from "../core/state-actions.js";
import { getRelevanceColor } from "../utils/app-utilities.js";
import { reinitializeSession } from "../services/workflows.js";
import { buildColumnMap, buildConfidenceColumnMap } from "../utils/column-utilities.js";
import { $ } from "../utils/dom-helpers.js";

let selectedRange = null, isProcessing = false, selectionHandler = null, isPanelOpen = false;

const HTML = `<summary class="panel-header collapsible-header">Direct Prompt</summary>
<div class="collapsible-content">
  <p class="collapsible-description">LLM inference with your own prompt. Select cells in Excel and provide instructions.</p>
  <div id="dp-range-display" class="range-display hidden">
    <span class="range-label">Selected:</span>
    <span id="dp-range-address" class="range-address">-</span>
    <span id="dp-range-count" class="range-count">0 cells</span>
  </div>
  <button id="dp-refresh-btn" class="btn-secondary mb-md">Refresh Selection</button>
  <div class="form-field">
    <label for="dp-user-prompt">Your Prompt:</label>
    <textarea id="dp-user-prompt" class="input input-md input-full input-textarea" placeholder="These are industrial pipe fittings. Match to standardized catalog codes..." rows="4"></textarea>
  </div>
  <div class="form-actions">
    <button id="dp-process-btn" class="btn-primary" disabled>Process</button>
    <button id="dp-clear-btn" class="btn-secondary">Clear</button>
  </div>
  <div id="dp-progress" class="progress-container hidden">
    <div class="progress-bar"><div id="dp-progress-fill" class="progress-fill" style="width:0%"></div></div>
    <div id="dp-progress-text" class="progress-text">Processing: 0 / 0</div>
  </div>
</div>`;

export function init() {
  const view = $("results-view");
  if (!view) return false;
  const section = document.createElement("details");
  section.id = "direct-prompt-details";
  section.className = "card card-lg card-muted";
  section.innerHTML = HTML;
  view.appendChild(section);

  section.addEventListener("toggle", e => {
    isPanelOpen = e.target.open;
    if (isPanelOpen) { refreshSelection(); startTracking(); } else stopTracking();
  });
  $("dp-refresh-btn")?.addEventListener("click", refreshSelection);
  $("dp-process-btn")?.addEventListener("click", processDirectPrompt);
  $("dp-clear-btn")?.addEventListener("click", clearSelection);
  $("dp-user-prompt")?.addEventListener("input", updateButtonState);
  return true;
}

async function startTracking() {
  if (selectionHandler) return;
  try {
    await Excel.run(async ctx => {
      selectionHandler = ctx.workbook.worksheets.getActiveWorksheet().onSelectionChanged.add(() => { if (isPanelOpen && !isProcessing) refreshSelection(); });
      await ctx.sync();
    });
  } catch {}
}

async function stopTracking() {
  if (!selectionHandler) return;
  try { await Excel.run(async ctx => { selectionHandler.remove(); await ctx.sync(); selectionHandler = null; }); } catch {}
}

async function refreshSelection() {
  try {
    await Excel.run(async ctx => {
      const range = ctx.workbook.getSelectedRange();
      range.load("address, rowCount, columnCount, values, rowIndex, columnIndex");
      await ctx.sync();
      selectedRange = { address: range.address, rowCount: range.rowCount, columnCount: range.columnCount, values: range.values, rowIndex: range.rowIndex, columnIndex: range.columnIndex };
      const cellCount = range.values.flat().filter(v => v && String(v).trim()).length;
      $("dp-range-display")?.classList.remove("hidden");
      $("dp-range-address").textContent = range.address;
      $("dp-range-count").textContent = `${cellCount} value${cellCount !== 1 ? 's' : ''}`;
      updateButtonState();
    });
  } catch (e) { showMessage(`Failed to read selection: ${e.message}`, "error"); }
}

function updateButtonState() {
  const hasValues = selectedRange?.values.flat().filter(v => v && String(v).trim()).length > 0;
  const btn = $("dp-process-btn");
  if (btn) btn.disabled = !(hasValues && $("dp-user-prompt")?.value.trim() && !isProcessing);
}

async function processDirectPrompt() {
  const userPrompt = $("dp-user-prompt")?.value.trim();
  const values = selectedRange?.values.flat().filter(v => v && String(v).trim()) || [];
  const error = !selectedRange ? "No range selected - click Refresh Selection" :
    !getStateValue('mappings.loaded') ? "Mappings not loaded" :
    isProcessing ? null : !userPrompt ? "Prompt is required" :
    !values.length ? "No values in selection" : values.length > 100 ? "Max 100 items allowed" : null;
  if (error) { showMessage(error, "error"); return; }
  if (isProcessing) return;
  if (!(await reinitializeSession())) { showMessage("Failed to initialize session", "error"); return; }

  isProcessing = true;
  $("dp-process-btn").disabled = true;
  $("dp-progress")?.classList.remove("hidden");

  try {
    const results = await processItems(values, userPrompt);
    await writeResultsToExcel(results);
    showMessage(`Direct prompt complete: ${results.length} items processed`);
  } catch (e) { showMessage(`Processing failed: ${e.message}`, "error"); }
  finally { isProcessing = false; updateButtonState(); $("dp-progress")?.classList.add("hidden"); }
}

async function processItems(values, userPrompt) {
  const results = [], host = getHost(), headers = getHeaders(), startTime = Date.now();
  let batchId = null, successCount = 0, errorCount = 0;

  if (values.length > 1) {
    try { batchId = (await apiPost(`${host}/batch/start`, { method: "DirectPrompt", user_prompt: userPrompt, item_count: values.length, items: values }, headers))?.batch_id; } catch {}
  }

  for (let i = 0; i < values.length; i++) {
    const value = String(values[i]).trim();
    $("dp-progress-fill").style.width = `${Math.round(((i + 1) / values.length) * 100)}%`;
    $("dp-progress-text").textContent = `Processing: ${i + 1} / ${values.length}`;

    try {
      const payload = { query: value, user_prompt: userPrompt };
      if (batchId) payload.batch_id = batchId;
      const data = await apiPost(`${host}/direct-prompt`, payload, headers);
      if (data) { results.push({ source: value, target: data.target || "No match", confidence: data.confidence ?? 0, confidence_corrected: data.confidence_corrected || false }); successCount++; }
      else { results.push({ source: value, target: "No response", confidence: 0 }); errorCount++; }
    } catch (e) { results.push({ source: value, target: `Error: ${e.message}`, confidence: 0 }); errorCount++; }
  }

  if (batchId) {
    try { await apiPost(`${host}/batch/complete`, { batch_id: batchId, success_count: successCount, error_count: errorCount, total_time_ms: Date.now() - startTime, results_summary: results.map(r => ({ source: r.source, target: r.target, confidence: r.confidence })) }, headers); } catch {}
  }
  return results;
}

async function writeResultsToExcel(results) {
  if (!results?.length) return;
  const config = getStateValue('config.data');
  if (!config?.column_map) { showMessage("No column mapping configured", "error"); return; }

  try {
    await Excel.run(async ctx => {
      ctx.runtime.enableEvents = false;
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      const usedRange = ws.getUsedRange(true);
      usedRange.load("columnIndex, columnCount");
      const headers = ws.getRangeByIndexes(0, 0, 1, 100);
      headers.load("values");
      await ctx.sync();

      const headerNames = headers.values[0].map(h => String(h || "").trim());
      let columnMap, confidenceColumnMap;
      try {
        columnMap = buildColumnMap(headerNames, config.column_map);
        confidenceColumnMap = buildConfidenceColumnMap(headerNames, config.confidence_column_map).confidenceColumnMap;
      } catch (e) { showMessage(`Column mapping error: ${e.message}`, "error"); return; }

      const sourceCol = selectedRange.columnIndex, targetCol = columnMap.get(sourceCol), confidenceCol = confidenceColumnMap?.get(sourceCol);
      if (targetCol === undefined) { showMessage("No column mapping found for selected column", "error"); return; }

      for (let i = 0; i < results.length; i++) {
        const rowIdx = selectedRange.rowIndex + i, { target, confidence } = results[i];
        const targetCell = ws.getRangeByIndexes(rowIdx, targetCol, 1, 1);
        targetCell.values = [[target || "No result"]];
        targetCell.format.fill.color = getRelevanceColor(confidence);
        if (confidenceCol !== undefined) ws.getRangeByIndexes(rowIdx, confidenceCol, 1, 1).values = [[confidence]];
      }
      await ctx.sync();
      ctx.runtime.enableEvents = true;
    });
  } catch (e) { showMessage(`Failed to write results: ${e.message}`, "error"); }
}

function clearSelection() {
  selectedRange = null;
  $("dp-range-display")?.classList.add("hidden");
  $("dp-user-prompt").value = "";
  $("dp-process-btn").disabled = true;
  showMessage("Selection cleared");
}
