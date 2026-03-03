import { showMessage } from "../utils/ui-feedback.js";
import { apiPost, serverFetch, getHeaders, buildUrl } from "../utils/api-fetch.js";
import { getStateValue } from "../core/state-actions.js";
import { getRelevanceColor } from "../utils/app-utilities.js";
import { ensureSessionInitialized } from "../services/workflows.js";
import { logMatchResult } from "../services/result-logger.js";
import { resolveColumnMaps } from "../utils/column-utilities.js";
import { $ } from "../utils/dom-helpers.js";
import { LIMITS, ENDPOINTS } from "../config/config.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { initPicker, startSelection, hide as hideCandidatePicker } from "./dp-candidate-picker.js";

let selectedRange = null, isProcessing = false, selectionHandler = null, isPanelOpen = false;
let allResults = []; // All results including pending

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
  const btn = $("dp-toggle-btn");
  if (!btn) return false;

  btn.addEventListener("click", togglePanel);

  // Create panel (hidden by default), insert after the h3
  const panel = document.createElement("div");
  panel.id = "direct-prompt-panel";
  panel.className = "direct-prompt-panel hidden";
  panel.innerHTML = HTML;
  btn.closest("h3")?.after(panel);

  // Wire up events
  $("dp-process-btn")?.addEventListener("click", processDirectPrompt);
  $("dp-clear-btn")?.addEventListener("click", clearSelection);
  $("dp-user-prompt")?.addEventListener("input", updateButtonState);

  // Initialize candidate picker inside the panel
  initPicker(panel);
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
            const ws = ctx.workbook.worksheets.getActiveWorksheet();
            const { columnMap } = await resolveColumnMaps(ws, ctx, config);
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
  if (!(await ensureSessionInitialized())) { showMessage("Failed to initialize session", "error"); return; }

  isProcessing = true;
  $("dp-process-btn").disabled = true;
  $("dp-progress")?.classList.remove("hidden");

  // Get project-specific context from config
  const projectContext = getStateValue('config.data')?.direct_prompt_context || null;

  try {
    const results = await processItems(values, userPrompt, projectContext);

    // Separate results into accepted and pending selection
    allResults = results;
    const pending = results.map((r, i) => ({ ...r, index: i })).filter(r => r.needs_user_selection);
    const acceptedResults = results.filter(r => !r.needs_user_selection);

    // Write accepted results immediately
    eventBus.emit(Events.BATCH_RESULTS, { items: acceptedResults, userPrompt });
    await _writeResultRows(results.map((r, i) => ({ rowIndex: selectedRange.rowIndex + i, target: r.target, confidence: r.confidence })));

    if (pending.length > 0) {
      startSelection(pending, {
        onSelect: (item, candidate) => _handleCandidateSelected(item, candidate),
        onResolved: () => {},
      });
      showMessage(`${acceptedResults.length} matched, ${pending.length} need selection`);
    } else {
      showMessage(`Direct prompt complete: ${results.length} items processed`);
    }
  } catch (e) { showMessage(`Processing failed: ${e.message}`, "error"); }
  finally { isProcessing = false; updateButtonState(); $("dp-progress")?.classList.add("hidden"); }
}

function _buildItemPayload(value, userPrompt, batchId, itemIndex, projectContext) {
  const payload = { query: value, user_prompt: userPrompt };
  if (batchId) payload.batch_id = batchId;
  if ($("dp-include-output")?.checked && selectedRange?.outputValues?.[itemIndex]) {
    const currentOutput = String(selectedRange.outputValues[itemIndex][0] || "").trim();
    if (currentOutput) payload.current_output = currentOutput;
  }
  if (projectContext) payload.project_context = projectContext;
  return payload;
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
      const data = await apiPost(buildUrl(ENDPOINTS.PROMPTS), _buildItemPayload(value, userPrompt, batchId, i, projectContext), headers);
      if (data) {
        const target = data.target || "No match";
        const confidence = data.confidence ?? 0;
        const result = {
          source: value, target, confidence,
          fuzzy_corrected: data.fuzzy_corrected || false, fuzzy_score: data.fuzzy_score ?? 0,
          needs_user_selection: data.needs_user_selection || false, candidates: data.candidates || [],
          original_target: data.original_target || null, rowIndex: selectedRange.rowIndex + i,
        };
        results.push(result);
        successCount++;

        if (!result.needs_user_selection) {
          logMatchResult(value, `dp-${batchId || 'single'}-${i}`, { target, method: "DirectPrompt", confidence });
        }
      }
      else { results.push({ source: value, target: "No response", confidence: 0, needs_user_selection: false, candidates: [] }); errorCount++; }
    } catch (e) { results.push({ source: value, target: `Error: ${e.message}`, confidence: 0, needs_user_selection: false, candidates: [] }); errorCount++; }
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

/**
 * Resolve column mappings and write result rows to Excel.
 * @param {{rowIndex: number, target: string, confidence: number}[]} rows - Rows to write
 */
async function _writeResultRows(rows) {
  if (!rows?.length) return;
  const config = getStateValue('config.data');
  if (!config?.column_map) { showMessage("No column mapping configured", "error"); return; }

  try {
    await Excel.run(async ctx => {
      ctx.runtime.enableEvents = false;
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      let columnMap, confidenceColumnMap;
      try {
        ({ columnMap, confidenceColumnMap } = await resolveColumnMaps(ws, ctx, config));
      } catch (e) { showMessage(`Column mapping error: ${e.message}`, "error"); return; }

      const sourceCol = selectedRange.columnIndex, targetCol = columnMap.get(sourceCol), confidenceCol = confidenceColumnMap?.get(sourceCol);
      if (targetCol === undefined) { showMessage("No column mapping found for selected column", "error"); return; }

      for (const { rowIndex, target, confidence } of rows) {
        const cell = ws.getRangeByIndexes(rowIndex, targetCol, 1, 1);
        cell.values = [[target || "No result"]];
        cell.format.fill.color = getRelevanceColor(confidence);
        if (confidenceCol !== undefined) ws.getRangeByIndexes(rowIndex, confidenceCol, 1, 1).values = [[confidence]];
      }
      await ctx.sync();
      ctx.runtime.enableEvents = true;
    });
  } catch (e) { showMessage(`Failed to write results: ${e.message}`, "error"); }
}

// ========== CANDIDATE SELECTION CALLBACK ==========

async function _handleCandidateSelected(pendingItem, selectedCandidate) {
  allResults[pendingItem.index].target = selectedCandidate;
  allResults[pendingItem.index].confidence = 1.0;
  allResults[pendingItem.index].needs_user_selection = false;

  await _writeResultRows([{ rowIndex: pendingItem.rowIndex, target: selectedCandidate, confidence: 1.0 }]);

  logMatchResult(pendingItem.source, `dp-selection-${pendingItem.index}`, { target: selectedCandidate, method: "UserChoice", confidence: 1.0 });
}

// ========== CLEAR / RESET ==========

function clearSelection() {
  selectedRange = null;
  allResults = [];
  hideCandidatePicker();
  $("dp-hint").textContent = "Select cells in Excel to begin.";
  $("dp-user-prompt").value = "";
  $("dp-process-btn").disabled = true;
  showMessage("Selection cleared");
}
