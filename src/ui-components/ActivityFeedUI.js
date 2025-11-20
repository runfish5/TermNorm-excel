import { getCellState } from "../services/live.tracker.js";

let container = null;
let tableBody = null;
const maxEntries = 50;
// Activity data model - references to cellState (no duplication)
export const activities = [];

export function init(containerId = "activity-feed") {
  container = document.getElementById(containerId);
  if (!container) {
    console.warn(`ActivityFeed: Container '${containerId}' not found - will try lazy init`);
    return false;
  }

  container.innerHTML = `
            <table class="activity-table">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Source</th>
                        <th>Target</th>
                        <th>Method</th>
                        <th>Confidence</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        `;

  tableBody = container?.querySelector("tbody");

  const clearBtn = document.getElementById("clear-activity");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => clear());
  }

  showPlaceholder();
  return true;
}

export function add(source, cellKey, timestamp) {
  if (!tableBody) {
    const initSuccess = init();
    if (!initSuccess || !tableBody) {
      console.warn("ActivityFeed: Cannot initialize - skipping add");
      return;
    }
  }

  try {
    // Remove placeholder if present
    const placeholder = tableBody?.querySelector(".placeholder-row");
    if (placeholder) placeholder.remove();

    // Store reference to cellState (not duplicate data)
    activities.unshift({ source, cellKey, timestamp });

    // Fetch result from cellState for display
    const state = getCellState(cellKey);
    const result = state?.result || {
      target: "Unknown",
      method: "-",
      confidence: 0,
      timestamp: timestamp
    };

    const { target, method, confidence, web_search_status } = result;

    // Build method display text with web search status indicator
    let methodText = method ? method.toUpperCase() : "-";
    if (web_search_status === "failed" && method === "ProfileRank") {
      methodText = `⚠️ ${methodText} (web scrape ∅)`;
    }

    const displayTime = timestamp
      ? new Date(timestamp).toLocaleTimeString()
      : new Date().toLocaleTimeString();

    // Create and insert row at beginning
    const row = document.createElement("tr");
    row.className = `activity-row ${method}`;
    row.innerHTML = `
      <td class="time">${displayTime}</td>
      <td class="source">${source || "-"}</td>
      <td class="target">${target || "-"}</td>
      <td class="method">${methodText}</td>
      <td class="confidence">${method !== "error" && confidence ? Math.round(confidence * 100) + "%" : "-"}</td>
    `;
    tableBody.insertBefore(row, tableBody.firstChild);

    // Remove excess rows if over maxEntries
    while (tableBody.children.length > maxEntries) {
      tableBody.removeChild(tableBody.lastChild);
      activities.pop();
    }

    updateHistoryTabCounter();
  } catch (error) {
    console.error("ActivityFeed.add() error:", error);
  }
}

export function clear() {
  if (!tableBody) return;
  activities.length = 0; // Clear data array
  tableBody.innerHTML = "";
  showPlaceholder();
  updateHistoryTabCounter();
}

/**
 * Scroll to and highlight activity matching the given cellKey
 * @param {string} cellKey - Cell key to find in activities
 * @returns {boolean} True if activity found and highlighted, false otherwise
 */
export function scrollToAndHighlight(cellKey) {
  if (!tableBody || !cellKey) return false;

  // Find activity index by cellKey
  const activityIndex = activities.findIndex(a => a.cellKey === cellKey);
  if (activityIndex === -1) return false;

  // Get corresponding row element
  const rows = tableBody.querySelectorAll(".activity-row");
  const targetRow = rows[activityIndex];
  if (!targetRow) return false;

  // Remove previous highlights
  rows.forEach(row => row.classList.remove("highlighted"));

  // Scroll to center and highlight
  targetRow.scrollIntoView({ behavior: "smooth", block: "center" });
  targetRow.classList.add("highlighted");

  // Auto-remove highlight after 3 seconds
  setTimeout(() => {
    targetRow.classList.remove("highlighted");
  }, 3000);

  return true;
}

function showPlaceholder() {
  if (!tableBody) return;
  if (!tableBody.querySelector(".activity-row")) {
    tableBody.innerHTML =
      '<tr class="placeholder-row"><td colspan="5">No activity yet. Start tracking to see live mappings.</td></tr>';
  }
}

export function updateHistoryTabCounter() {
  const historyTab = document.getElementById("history-tab");
  if (historyTab && tableBody) {
    const activityRows = tableBody.querySelectorAll(".activity-row");
    const count = activityRows.length;
    const tabIcon = historyTab.querySelector(".tab-icon");
    if (tabIcon) {
      tabIcon.textContent = `${count}📜`;
    }
  }
}

export function getCount() {
  return activities.length;
}
