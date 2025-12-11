import { showMessage } from "../utils/error-display.js";
import { apiPost } from "../utils/api-fetch.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { getStateValue } from "../core/state-actions.js";
import { getRelevanceColor } from "../utils/app-utilities.js";
import { reinitializeSession } from "../services/state-manager.js";
import { buildColumnMap, buildConfidenceColumnMap } from "../utils/column-utilities.js";

let selectedRange = null;
let isProcessing = false;
let selectionHandler = null;
let isPanelOpen = false;

let elements = {};

export function init() {
  const view = document.getElementById("results-view");
  if (!view) return false;

  const section = document.createElement("details");
  section.id = "direct-prompt-details";
  section.className = "card card-lg card-muted";
  section.innerHTML = `
      <summary class="panel-header collapsible-header">Direct Prompt</summary>
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
          <div class="progress-bar">
            <div id="dp-progress-fill" class="progress-fill" style="width:0%"></div>
          </div>
          <div id="dp-progress-text" class="progress-text">Processing: 0 / 0</div>
        </div>
      </div>`;
  view.appendChild(section);

  elements = {
    details: section,
    rangeDisplay: document.getElementById("dp-range-display"),
    rangeAddress: document.getElementById("dp-range-address"),
    rangeCount: document.getElementById("dp-range-count"),
    refreshBtn: document.getElementById("dp-refresh-btn"),
    userPrompt: document.getElementById("dp-user-prompt"),
    processBtn: document.getElementById("dp-process-btn"),
    clearBtn: document.getElementById("dp-clear-btn"),
    progress: document.getElementById("dp-progress"),
    progressFill: document.getElementById("dp-progress-fill"),
    progressText: document.getElementById("dp-progress-text"),
  };

  const missing = Object.entries(elements).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error("[DirectPrompt] Missing elements:", missing);
    return false;
  }

  elements.details.addEventListener("toggle", onPanelToggle);
  elements.refreshBtn.addEventListener("click", refreshSelection);
  elements.processBtn.addEventListener("click", processDirectPrompt);
  elements.clearBtn.addEventListener("click", clearSelection);
  elements.userPrompt.addEventListener("input", updateButtonState);

  return true;
}

function onPanelToggle(e) {
  isPanelOpen = e.target.open;
  if (isPanelOpen) {
    refreshSelection();
    startSelectionTracking();
  } else {
    stopSelectionTracking();
  }
}

async function startSelectionTracking() {
  if (selectionHandler) return;
  try {
    await Excel.run(async (ctx) => {
      const sheet = ctx.workbook.worksheets.getActiveWorksheet();
      selectionHandler = sheet.onSelectionChanged.add(onExcelSelectionChanged);
      await ctx.sync();
    });
  } catch (e) {
    console.warn("[DirectPrompt] Could not start selection tracking:", e.message);
  }
}

async function stopSelectionTracking() {
  if (!selectionHandler) return;
  try {
    await Excel.run(async (ctx) => {
      selectionHandler.remove();
      await ctx.sync();
      selectionHandler = null;
    });
  } catch (e) {
    console.warn("[DirectPrompt] Could not stop selection tracking:", e.message);
  }
}

function onExcelSelectionChanged() {
  if (isPanelOpen && !isProcessing) refreshSelection();
}

async function refreshSelection() {
  try {
    await Excel.run(async (ctx) => {
      const range = ctx.workbook.getSelectedRange();
      range.load("address, rowCount, columnCount, values, rowIndex, columnIndex");
      await ctx.sync();

      selectedRange = {
        address: range.address,
        rowCount: range.rowCount,
        columnCount: range.columnCount,
        values: range.values,
        rowIndex: range.rowIndex,
        columnIndex: range.columnIndex
      };

      const cellCount = range.values.flat().filter(v => v && String(v).trim()).length;

      elements.rangeDisplay.classList.remove("hidden");
      elements.rangeAddress.textContent = range.address;
      elements.rangeCount.textContent = `${cellCount} value${cellCount !== 1 ? 's' : ''}`;

      updateButtonState();
    });
  } catch (e) {
    showMessage(`Failed to read selection: ${e.message}`, "error");
  }
}

function updateButtonState() {
  const hasValues = selectedRange &&
    selectedRange.values.flat().filter(v => v && String(v).trim()).length > 0;
  const hasPrompt = elements.userPrompt.value.trim().length > 0;
  elements.processBtn.disabled = !(hasValues && hasPrompt && !isProcessing);
}

async function processDirectPrompt() {
  if (!selectedRange) {
    showMessage("No range selected - click Refresh Selection", "error");
    return;
  }

  if (!getStateValue('mappings.loaded')) {
    showMessage("Mappings not loaded", "error");
    return;
  }

  if (isProcessing) return;

  if (!(await reinitializeSession())) {
    showMessage("Failed to initialize session - check server connection and mappings", "error");
    return;
  }

  const userPrompt = elements.userPrompt.value.trim();
  if (!userPrompt) {
    showMessage("Prompt is required", "error");
    return;
  }

  const values = selectedRange.values.flat().filter(v => v && String(v).trim());
  if (!values.length) {
    showMessage("No values in selection", "error");
    return;
  }

  if (values.length > 100) {
    showMessage("Max 100 items allowed", "error");
    return;
  }

  isProcessing = true;
  elements.processBtn.disabled = true;
  elements.progress.classList.remove("hidden");

  try {
    const results = await processItems(values, userPrompt);
    await writeResultsToExcel(results);
    showMessage(`Direct prompt complete: ${results.length} items processed`);
  } catch (e) {
    showMessage(`Processing failed: ${e.message}`, "error");
  } finally {
    isProcessing = false;
    updateButtonState();
    elements.progress.classList.add("hidden");
  }
}

async function processItems(values, userPrompt) {
  const results = [];
  const host = getHost();
  const headers = getHeaders();
  const startTime = Date.now();
  let batchId = null;
  let successCount = 0;
  let errorCount = 0;

  // Start batch for tracking (captures all input items)
  if (values.length > 1) {
    try {
      const batchData = await apiPost(
        `${host}/batch/start`,
        {
          method: "DirectPrompt",
          user_prompt: userPrompt,
          item_count: values.length,
          items: values // Log all input items for rediscoverability
        },
        headers
      );
      batchId = batchData?.batch_id;
    } catch (e) {
      console.warn("[DirectPrompt] Batch start failed:", e.message);
    }
  }

  for (let i = 0; i < values.length; i++) {
    const value = String(values[i]).trim();
    const progress = Math.round(((i + 1) / values.length) * 100);

    elements.progressFill.style.width = `${progress}%`;
    elements.progressText.textContent = `Processing: ${i + 1} / ${values.length}`;

    try {
      const payload = { query: value, user_prompt: userPrompt };
      if (batchId) payload.batch_id = batchId;

      const data = await apiPost(`${host}/direct-prompt`, payload, headers);

      if (data) {
        results.push({
          source: value,
          target: data.target || "No match",
          confidence: data.confidence ?? 0,
          confidence_corrected: data.confidence_corrected || false
        });
        successCount++;
      } else {
        results.push({ source: value, target: "No response", confidence: 0 });
        errorCount++;
      }
    } catch (e) {
      results.push({ source: value, target: `Error: ${e.message}`, confidence: 0 });
      errorCount++;
    }
  }

  // Complete batch with summary
  if (batchId) {
    try {
      await apiPost(
        `${host}/batch/complete`,
        {
          batch_id: batchId,
          success_count: successCount,
          error_count: errorCount,
          total_time_ms: Date.now() - startTime,
          results_summary: results.map(r => ({ source: r.source, target: r.target, confidence: r.confidence }))
        },
        headers
      );
    } catch (e) {
      console.warn("[DirectPrompt] Batch complete failed:", e.message);
    }
  }

  return results;
}

async function writeResultsToExcel(results) {
  if (!results?.length) return;

  const config = getStateValue('config.data');
  if (!config?.column_map) {
    showMessage("No column mapping configured", "error");
    return;
  }

  try {
    await Excel.run(async (ctx) => {
      ctx.runtime.enableEvents = false;
      const ws = ctx.workbook.worksheets.getActiveWorksheet();

      // Get headers
      const usedRange = ws.getUsedRange(true);
      usedRange.load("columnIndex, columnCount");
      await ctx.sync();

      const headers = ws.getRangeByIndexes(0, 0, 1, usedRange.columnIndex + usedRange.columnCount);
      headers.load("values");
      await ctx.sync();

      const headerNames = headers.values[0].map(h => String(h || "").trim());

      // Build column maps
      let columnMap, confidenceColumnMap;
      try {
        columnMap = buildColumnMap(headerNames, config.column_map);
        const confResult = buildConfidenceColumnMap(headerNames, config.confidence_column_map);
        confidenceColumnMap = confResult.confidenceColumnMap;
      } catch (e) {
        showMessage(`Column mapping error: ${e.message}`, "error");
        return;
      }

      // Find target column for source column
      const sourceCol = selectedRange.columnIndex;
      const targetCol = columnMap.get(sourceCol);
      const confidenceCol = confidenceColumnMap?.get(sourceCol);

      if (targetCol === undefined) {
        showMessage(`No column mapping found for selected column. Configure column_map in app.config.json.`, "error");
        return;
      }

      // Write results
      for (let i = 0; i < results.length; i++) {
        const rowIdx = selectedRange.rowIndex + i;
        const { target, confidence } = results[i];

        const targetCell = ws.getRangeByIndexes(rowIdx, targetCol, 1, 1);
        targetCell.values = [[target || "No result"]];
        targetCell.format.fill.color = getRelevanceColor(confidence);

        if (confidenceCol !== undefined) {
          ws.getRangeByIndexes(rowIdx, confidenceCol, 1, 1).values = [[confidence]];
        }
      }

      await ctx.sync();
      ctx.runtime.enableEvents = true;
    });
  } catch (e) {
    showMessage(`Failed to write results: ${e.message}`, "error");
  }
}

function clearSelection() {
  selectedRange = null;
  elements.rangeDisplay.classList.add("hidden");
  elements.userPrompt.value = "";
  elements.processBtn.disabled = true;
  showMessage("Selection cleared");
}
