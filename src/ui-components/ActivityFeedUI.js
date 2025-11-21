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

/**
 * Handle cell selection from Excel - switch to history tab, scroll to activity, show details
 * @param {string} cellKey - Cell key (row:col format)
 * @param {Object} state - Cell state from cellState Map
 */
export async function handleCellSelection(cellKey, state) {
  // Switch to history tab
  const { showView } = await import("./view-manager.js");
  showView("history");

  // Scroll to and highlight the activity
  const found = scrollToAndHighlight(cellKey);

  if (!found) {
    console.warn(`No activity found for cellKey: ${cellKey}`);
    return;
  }

  // If method is ProfileRank and we have timestamp, fetch and show details
  const result = state.result;
  if (result.method === "ProfileRank" && result.timestamp) {
    await fetchAndDisplayDetails(result.timestamp);
  }
}

// Fetch match details from backend
async function fetchAndDisplayDetails(timestamp) {
  const { apiGet } = await import("../utils/api-fetch.js");
  const { getHost } = await import("../utils/server-utilities.js");

  try {
    const response = await apiGet(`${getHost()}/match-details/${encodeURIComponent(timestamp)}`);

    if (!response || response.status === "error") {
      console.warn("Failed to fetch match details:", response?.message);
      return;
    }

    displayDetailsPanel(response.data);
  } catch (error) {
    console.error("Error fetching match details:", error);
  }
}

// Display details in expandable panel
function displayDetailsPanel(details) {
  if (!details) return;

  // Remove existing panel if any
  const existingPanel = document.getElementById("match-details-panel");
  if (existingPanel) existingPanel.remove();

  const panel = document.createElement("div");
  panel.id = "match-details-panel";
  panel.className = "match-details-panel";

  panel.innerHTML = `
    <div class="details-header">
      <h4>Match Details: ${details.source || "Unknown"} → ${details.target || "Unknown"}</h4>
      <button class="close-btn">×</button>
    </div>
    <div class="details-content">
      <div class="detail-section">
        <h5>Entity Profile</h5>
        <div class="entity-profile">
          ${formatEntityProfile(details.entity_profile)}
        </div>
      </div>
      <div class="detail-section">
        <h5>Web Sources (${details.web_sources?.length || 0})</h5>
        <ul class="source-list">
          ${details.web_sources?.map(s => `
            <li><a href="${s.url || s}" target="_blank">${s.title || s.url || s}</a></li>
          `).join('') || '<li>No sources</li>'}
        </ul>
      </div>
      <div class="detail-section">
        <h5>All Candidates (${details.candidates?.length || 0})</h5>
        <div class="candidate-list">
          ${details.candidates?.map((c, i) => `
            <div class="candidate-item">
              <span class="rank">#${i + 1}</span>
              <span class="name">${c.name || c.candidate}</span>
              <span class="score">${Math.round((c.score || c.relevance_score || 0) * 100)}%</span>
            </div>
          `).join('') || '<div>No candidates</div>'}
        </div>
      </div>
      <div class="detail-meta">
        <span>LLM: ${details.llm_provider || "Unknown"}</span>
        <span>Time: ${details.total_time ? details.total_time + "s" : "N/A"}</span>
        <span>Web: ${details.web_search_status || "N/A"}</span>
      </div>
    </div>
  `;

  // Insert before activity table
  const activityFeed = document.getElementById("activity-feed");
  if (activityFeed && activityFeed.parentElement) {
    activityFeed.parentElement.insertBefore(panel, activityFeed);
  }

  // Add close handler
  panel.querySelector(".close-btn").onclick = () => panel.remove();
}

// Helper to format entity profile
function formatEntityProfile(profile) {
  if (!profile) return "<p>No profile available</p>";

  return `
    <div class="profile-field">
      <strong>Name:</strong> ${profile.entity_name || profile.name || "N/A"}
    </div>
    <div class="profile-field">
      <strong>Core Concept:</strong> ${profile.core_concept || "N/A"}
    </div>
    <div class="profile-field">
      <strong>Key Features:</strong> ${profile.distinguishing_features?.slice(0, 5).join(", ") || profile.key_features?.join(", ") || "N/A"}
    </div>
  `;
}
