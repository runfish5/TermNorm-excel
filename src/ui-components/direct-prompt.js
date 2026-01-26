import { showMessage } from "../utils/ui-feedback.js";
import { apiPost, serverFetch, getHeaders, buildUrl } from "../utils/api-fetch.js";
import { getStateValue } from "../core/state-actions.js";
import { getRelevanceColor } from "../utils/app-utilities.js";
import { reinitializeSession } from "../services/workflows.js";
import { buildColumnMap, buildConfidenceColumnMap } from "../utils/column-utilities.js";
import { $ } from "../utils/dom-helpers.js";
import { LIMITS, ENDPOINTS } from "../config/config.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

let selectedRange = null, isProcessing = false, selectionHandler = null, isPanelOpen = false;

const HTML = `<div class="direct-prompt-content">
  <div class="form-field">
    <label for="dp-user-prompt">Your Prompt:</label>
    <textarea id="dp-user-prompt" class="input input-md input-full input-textarea" placeholder="These are industrial pipe fittings. Match to standardized catalog codes..." rows="4"></textarea>
  </div>
  <div class="form-actions">
    <button id="dp-process-btn" class="btn-primary" disabled>Process</button>
    <button id="dp-clear-btn" class="btn-secondary">Clear</button>
  </div>
  <div class="dp-status-row">
    <span id="dp-hint" class="hint-text">Select cells in Excel to begin.</span>
    <label class="checkbox-label"><input type="checkbox" id="dp-include-output" checked> Include output</label>
  </div>
  <div id="dp-progress" class="progress-container hidden">
    <div class="progress-bar"><div id="dp-progress-fill" class="progress-fill"></div></div>
    <div id="dp-progress-text" class="progress-text">Processing: 0 / 0</div>
  </div>
</div>`;

export function init() {
  const resultsView = $("results-view");
  if (!resultsView) return false;

  // Create trigger button
  const btn = document.createElement("button");
  btn.id = "dp-toggle-btn";
  btn.className = "btn-sm btn-secondary";
  btn.textContent = "Direct Prompt";
  btn.addEventListener("click", togglePanel);

  // Insert button after the h3 header
  const header = resultsView.querySelector("h3");
  header?.after(btn);

  // Create panel (hidden by default)
  const panel = document.createElement("div");
  panel.id = "direct-prompt-panel";
  panel.className = "direct-prompt-panel hidden";
  panel.innerHTML = HTML;
  btn.after(panel);

  // Wire up events
  $("dp-process-btn")?.addEventListener("click", processDirectPrompt);
  $("dp-clear-btn")?.addEventListener("click", clearSelection);
  $("dp-user-prompt")?.addEventListener("input", updateButtonState);
  return true;
}

function togglePanel() {
  const panel = $("direct-prompt-panel");
  if (!panel) return;
  const wasHidden = panel.classList.toggle("hidden");
  isPanelOpen = !wasHidden;
  if (isPanelOpen) { refreshSelection(); startTracking(); }
  else stopTracking();
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
      selectedRange = { address: range.address, rowCount: range.rowCount, columnCount: range.columnCount, values: range.values, rowIndex: range.rowIndex, columnIndex: range.columnIndex, outputValues: null };

      // Try to read output column values (single-column selection only)
      if (range.columnCount === 1) {
        try {
          const config = getStateValue('config.data');
          if (config?.column_map) {
            const headers = ctx.workbook.worksheets.getActiveWorksheet().getRangeByIndexes(0, 0, 1, LIMITS.MAX_HEADER_COLUMNS);
            headers.load("values");
            await ctx.sync();

            const headerNames = headers.values[0].map(h => String(h || "").trim());
            const columnMap = buildColumnMap(headerNames, config.column_map);
            const outputColIdx = columnMap.get(range.columnIndex);

            if (outputColIdx !== undefined) {
              const outputRange = ctx.workbook.worksheets.getActiveWorksheet().getRangeByIndexes(range.rowIndex, outputColIdx, range.rowCount, 1);
              outputRange.load("values");
              await ctx.sync();
              selectedRange.outputValues = outputRange.values;
            }
          }
        } catch {} // Silently proceed without output values
      }

      // Update hint with selection info (strip sheet prefix)
      const cellCount = range.values.flat().filter(v => v && String(v).trim()).length;
      const address = range.address.includes("!") ? range.address.split("!")[1] : range.address;
      $("dp-hint").textContent = cellCount ? `Selected: ${address} (${cellCount} value${cellCount !== 1 ? "s" : ""})` : "Select cells in Excel to begin.";
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
    !values.length ? "No values in selection" : values.length > LIMITS.MAX_DIRECT_PROMPT_ITEMS ? `Max ${LIMITS.MAX_DIRECT_PROMPT_ITEMS} items allowed` : null;
  if (error) { showMessage(error, "error"); return; }
  if (isProcessing) return;
  if (!(await reinitializeSession())) { showMessage("Failed to initialize session", "error"); return; }

  isProcessing = true;
  $("dp-process-btn").disabled = true;
  $("dp-progress")?.classList.remove("hidden");

  // Get project-specific context from config
  const projectContext = getStateValue('config.data')?.direct_prompt_context || null;

  try {
    const results = await processItems(values, userPrompt, projectContext);
    eventBus.emit(Events.BATCH_RESULTS, { items: results, userPrompt });
    await writeResultsToExcel(results);
    showMessage(`Direct prompt complete: ${results.length} items processed`);
  } catch (e) { showMessage(`Processing failed: ${e.message}`, "error"); }
  finally { isProcessing = false; updateButtonState(); $("dp-progress")?.classList.add("hidden"); }
}

async function processItems(values, userPrompt, projectContext = null) {
  const results = [], headers = getHeaders(), startTime = Date.now();
  let batchId = null, successCount = 0, errorCount = 0;

  if (values.length > 1) {
    try { batchId = (await apiPost(buildUrl(ENDPOINTS.BATCHES), { method: "DirectPrompt", user_prompt: userPrompt, item_count: values.length, items: values }, headers))?.batch_id; } catch {}
  }

  for (let i = 0; i < values.length; i++) {
    const value = String(values[i]).trim();
    $("dp-progress-fill").style.width = `${Math.round(((i + 1) / values.length) * 100)}%`;
    $("dp-progress-text").textContent = `Processing: ${i + 1} / ${values.length}`;

    try {
      const payload = { query: value, user_prompt: userPrompt };
      if (batchId) payload.batch_id = batchId;
      // Include current output value if toggle is enabled
      const includeOutput = $("dp-include-output")?.checked;
      if (includeOutput && selectedRange?.outputValues?.[i]) {
        const currentOutput = String(selectedRange.outputValues[i][0] || "").trim();
        if (currentOutput) payload.current_output = currentOutput;
      }
      // Include project context if configured
      if (projectContext) payload.project_context = projectContext;

      const data = await apiPost(buildUrl(ENDPOINTS.PROMPTS), payload, headers);
      if (data) {
        const target = data.target || "No match";
        const confidence = data.confidence ?? 0;
        results.push({ source: value, target, confidence, confidence_corrected: data.confidence_corrected || false });
        successCount++;
        eventBus.emit(Events.MATCH_LOGGED, {
          value,
          cellKey: `dp-${batchId || 'single'}-${i}`,
          timestamp: new Date().toISOString(),
          result: { target, method: "DirectPrompt", confidence, web_search_status: "idle" }
        });
      }
      else { results.push({ source: value, target: "No response", confidence: 0 }); errorCount++; }
    } catch (e) { results.push({ source: value, target: `Error: ${e.message}`, confidence: 0 }); errorCount++; }
  }

  if (batchId) {
    try {
      await serverFetch(`${buildUrl(ENDPOINTS.BATCHES)}/${batchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ success_count: successCount, error_count: errorCount, total_time_ms: Date.now() - startTime, results_summary: results.map(r => ({ source: r.source, target: r.target, confidence: r.confidence })) })
      });
    } catch {}
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
      const headers = ws.getRangeByIndexes(0, 0, 1, LIMITS.MAX_HEADER_COLUMNS);
      headers.load("values");
      await ctx.sync();

      const headerNames = headers.values[0].map(h => String(h || "").trim());
      let columnMap, confidenceColumnMap;
      try {
        columnMap = buildColumnMap(headerNames, config.column_map);
        confidenceColumnMap = buildConfidenceColumnMap(headerNames, config.column_map).confidenceColumnMap;
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
  $("dp-hint").textContent = "Select cells in Excel to begin.";
  $("dp-user-prompt").value = "";
  $("dp-process-btn").disabled = true;
  showMessage("Selection cleared");
}
