// BatchProcessingUI.js - Batch processing with user context
import { showMessage } from "../utils/error-display.js";
import { apiPost } from "../utils/api-fetch.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { state } from "../shared-services/state-machine.manager.js";
import { getRelevanceColor } from "../utils/app-utilities.js";

let selectedRange = null;
let isProcessing = false;

export function init() {
  const resultsView = document.getElementById("results-view");
  if (!resultsView) {
    console.warn("BatchProcessingUI: results-view not found");
    return false;
  }

  // Add batch processing section
  const batchSection = document.createElement("div");
  batchSection.id = "batch-processing-section";
  batchSection.className = "card card-lg card-muted";
  batchSection.innerHTML = `
    <details class="card batch-collapsible">
      <summary class="panel-header panel-header-collapsible batch-header">Batch Processing</summary>
      <div class="batch-content">
        <p class="batch-description">
          Select a range of cells in Excel, provide optional context, and process them all at once.
        </p>

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
          <textarea
            id="batch-context"
            class="input input-md input-full input-textarea"
            placeholder="Provide additional context for the LLM to consider when matching..."
            rows="3"
          ></textarea>
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
            <div class="progress-fill" style="width: 0%"></div>
          </div>
          <div class="progress-text">Processing: 0 / 0</div>
        </div>
      </div>
    </details>
  `;

  resultsView.appendChild(batchSection);
  setupBatchHandlers();
  return true;
}

function setupBatchHandlers() {
  document.getElementById("select-range-btn")?.addEventListener("click", selectRange);
  document.getElementById("batch-process-btn")?.addEventListener("click", processBatch);
  document.getElementById("cancel-batch-btn")?.addEventListener("click", cancelBatch);
}

async function selectRange() {
  try {
    await Excel.run(async (ctx) => {
      const range = ctx.workbook.getSelectedRange();
      range.load("address, rowCount, columnCount, values, rowIndex, columnIndex");
      await ctx.sync();

      // Store range info
      selectedRange = {
        address: range.address,
        rowCount: range.rowCount,
        columnCount: range.columnCount,
        values: range.values,
        rowIndex: range.rowIndex,
        columnIndex: range.columnIndex
      };

      // Update UI
      document.getElementById("range-display").classList.remove("hidden");
      document.getElementById("range-address").textContent = range.address;
      document.getElementById("range-count").textContent =
        `${range.rowCount} rows × ${range.columnCount} cols`;
      document.getElementById("batch-process-btn").disabled = false;

      showMessage(`Selected range: ${range.address}`);
    });
  } catch (error) {
    showMessage(`Failed to select range: ${error.message}`, "error");
  }
}

async function processBatch() {
  if (!selectedRange) {
    showMessage("No range selected", "error");
    return;
  }

  if (!state.mappings.loaded) {
    showMessage("Mappings not loaded - load configuration first", "error");
    return;
  }

  if (isProcessing) {
    showMessage("Batch processing already in progress", "error");
    return;
  }

  const contextMessage = document.getElementById("batch-context").value.trim();

  // Extract values from range (flatten to array, filter empty)
  const values = selectedRange.values.flat().filter(v => v && String(v).trim());

  if (values.length === 0) {
    showMessage("No values to process in selected range", "error");
    return;
  }

  if (values.length > 100) {
    showMessage("Maximum 100 items per batch. Select a smaller range.", "error");
    return;
  }

  // Disable buttons during processing
  isProcessing = true;
  document.getElementById("batch-process-btn").disabled = true;
  document.getElementById("select-range-btn").disabled = true;

  // Show progress
  const progressDiv = document.getElementById("batch-progress");
  progressDiv.classList.remove("hidden");

  try {
    const results = await batchProcessWithProgress(values, contextMessage,
      (current, total) => updateProgress(current, total)
    );

    // Write results back to Excel
    await writeResultsToExcel(results);

    showMessage(`Batch complete: ${results.length} items processed`);
  } catch (error) {
    showMessage(`Batch processing failed: ${error.message}`, "error");
  } finally {
    // Re-enable buttons
    isProcessing = false;
    document.getElementById("batch-process-btn").disabled = false;
    document.getElementById("select-range-btn").disabled = false;
    progressDiv.classList.add("hidden");
  }
}

async function batchProcessWithProgress(values, context, progressCallback) {
  const results = [];

  for (let i = 0; i < values.length; i++) {
    const value = String(values[i]).trim();
    progressCallback(i + 1, values.length);

    try {
      const response = await apiPost(
        `${getHost()}/batch-process-single`,
        { query: value, context: context },
        getHeaders()
      );

      if (response && response.status === "success" && response.data) {
        results.push({
          source: value,
          target: response.data.target || "No match",
          confidence: response.data.confidence || 0
        });
      } else {
        results.push({
          source: value,
          target: response?.message || "API error",
          confidence: 0
        });
      }
    } catch (error) {
      results.push({
        source: value,
        target: `Error: ${error.message}`,
        confidence: 0
      });
    }
  }

  return results;
}

function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);
  document.querySelector(".progress-fill").style.width = `${percent}%`;
  document.querySelector(".progress-text").textContent =
    `Processing: ${current} / ${total}`;
}

async function writeResultsToExcel(results) {
  await Excel.run(async (ctx) => {
    ctx.runtime.enableEvents = false;

    const ws = ctx.workbook.worksheets.getActiveWorksheet();

    // Determine output column (next column after selection)
    const outputCol = selectedRange.columnIndex + selectedRange.columnCount;

    // Write results - one per row starting from selection's row
    for (let i = 0; i < results.length; i++) {
      const row = selectedRange.rowIndex + i;
      const cell = ws.getRangeByIndexes(row, outputCol, 1, 1);
      cell.values = [[results[i].target]];
      cell.format.fill.color = getRelevanceColor(results[i].confidence);
    }

    await ctx.sync();
    ctx.runtime.enableEvents = true;
  });
}

function cancelBatch() {
  selectedRange = null;
  document.getElementById("range-display").classList.add("hidden");
  document.getElementById("batch-context").value = "";
  document.getElementById("batch-process-btn").disabled = true;
  showMessage("Batch selection cleared");
}
