import { getCellState } from "../services/live.tracker.js";

let container = null;
let tableBody = null;
const maxEntries = 50;
// Activity data model - references to cellState (no duplication)
export const activities = [];

// Track expanded row state for collapse/restore
let expandedRowState = null; // { originalRow, expandedRow }

export function init(containerId = "activity-feed") {
  container = document.getElementById(containerId);
  if (!container) {
    console.warn(`ActivityFeed: Container '${containerId}' not found - will try lazy init`);
    return false;
  }

  // Check if already initialized (tableBody exists and is still in DOM)
  if (tableBody && tableBody.isConnected) {
    return true;
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
    row.dataset.cellKey = cellKey;
    row.dataset.identifier = target || "";
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
 * Scroll to and highlight activity matching the given key
 * @param {string} key - Cell key or identifier to find
 * @param {string} [type="cellKey"] - Type of key: "cellKey" or "identifier"
 * @returns {HTMLElement|null} The target row element, or null if not found
 */
export function scrollToAndHighlight(key, type = "cellKey") {
  if (!tableBody || !key) return null;

  // Find row by data attribute (works for both session and cached entries)
  const selector = type === "identifier"
    ? `[data-identifier="${CSS.escape(key)}"]`
    : `[data-cell-key="${CSS.escape(key)}"]`;

  let targetRow = tableBody.querySelector(selector);

  // Fallback: try the other type if not found
  if (!targetRow && type === "cellKey") {
    targetRow = tableBody.querySelector(`[data-identifier="${CSS.escape(key)}"]`);
  }

  if (!targetRow) return null;

  // Collapse any previously expanded row
  collapseExpandedRow();

  // Scroll to center
  targetRow.scrollIntoView({ behavior: "smooth", block: "center" });

  return targetRow;
}

function showPlaceholder() {
  if (!tableBody) return;
  if (!tableBody.querySelector(".activity-row")) {
    tableBody.innerHTML =
      '<tr class="placeholder-row"><td colspan="5">No activity yet. Start tracking to see live mappings.</td></tr>';
  }
}

/**
 * Collapse any currently expanded row back to its original state
 */
function collapseExpandedRow() {
  if (!expandedRowState) return;

  const { originalRow, expandedRow } = expandedRowState;
  if (expandedRow && expandedRow.parentNode && originalRow) {
    expandedRow.parentNode.replaceChild(originalRow, expandedRow);

    // Re-attach click handler to restored row (cloneNode doesn't copy events)
    const identifier = originalRow.dataset.identifier;
    if (identifier) {
      originalRow.style.cursor = "pointer";
      originalRow.addEventListener("click", (e) => {
        e.stopPropagation();
        fetchAndDisplayDetails(identifier, originalRow);
      });
    }
  }
  expandedRowState = null;
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
 * @param {string|null} cellKey - Cell key (row:col format) for current session
 * @param {Object|null} state - Cell state from cellState Map
 * @param {string|null} identifier - Identifier (target) for historical lookup
 */
export async function handleCellSelection(cellKey, state, identifier) {
  // Switch to history tab
  const { showView } = await import("./view-manager.js");
  showView("history");

  // Determine identifier for lookup
  let lookupIdentifier = identifier;
  if (!lookupIdentifier && state?.result?.target) {
    lookupIdentifier = state.result.target;
  }

  // Try to scroll to activity - first by cellKey, then by identifier
  let targetRow = null;
  if (cellKey) {
    targetRow = scrollToAndHighlight(cellKey, "cellKey");
  }
  if (!targetRow && lookupIdentifier) {
    targetRow = scrollToAndHighlight(lookupIdentifier, "identifier");
  }

  // Show details in-place if we found the row
  if (lookupIdentifier && targetRow) {
    await fetchAndDisplayDetails(lookupIdentifier, targetRow);
  }
}

// Fetch match details - cache first, then server fallback
async function fetchAndDisplayDetails(identifier, targetRow) {
  // Check cache first
  const { state } = await import("../shared-services/state-machine.manager.js");
  const cachedEntry = state.history.entries[identifier];

  if (cachedEntry) {
    console.log("[ActivityFeed] Using cached entry for:", identifier.substring(0, 40));
    displayDetailsPanel({ identifier, ...cachedEntry }, targetRow);
    return;
  }

  // Fall back to server request if not in cache
  const { apiGet } = await import("../utils/api-fetch.js");
  const { getHost } = await import("../utils/server-utilities.js");

  try {
    const response = await apiGet(`${getHost()}/match-details/${encodeURIComponent(identifier)}`);

    if (!response || response.status === "error") {
      console.warn("Failed to fetch match details:", response?.message);
      return;
    }

    displayDetailsPanel(response.data, targetRow);
  } catch (error) {
    console.error("Error fetching match details:", error);
  }
}

// Display details in-place by replacing the target row
function displayDetailsPanel(details, targetRow) {
  if (!details || !targetRow) return;

  // Collapse any previously expanded row first
  collapseExpandedRow();

  // Re-query row if it was detached during collapse (could happen if targetRow WAS the expanded row)
  if (!targetRow.isConnected && details.identifier) {
    targetRow = tableBody?.querySelector(`[data-identifier="${CSS.escape(details.identifier)}"]`);
    if (!targetRow) return; // Row no longer exists
  }

  // Clone the original row before replacing (for restore on collapse)
  const originalRow = targetRow.cloneNode(true);

  // Format aliases list
  const aliases = details.aliases || {};
  const aliasEntries = Object.entries(aliases);
  const aliasCount = aliasEntries.length;

  // Create expanded row
  const expandedRow = document.createElement("tr");
  expandedRow.className = "activity-row expanded-details";
  expandedRow.dataset.identifier = details.identifier || "";

  expandedRow.innerHTML = `
    <td colspan="5" class="details-cell">
      <div class="inline-details-panel">
        <div class="details-header">
          <div class="details-title">
            <strong>Target:</strong> ${details.identifier || "Unknown"}
          </div>
          <button class="collapse-btn" title="Collapse">▲</button>
        </div>
        <div class="details-content">
          <div class="detail-section">
            <h5>Entity Profile</h5>
            <div class="entity-profile">
              ${formatEntityProfile(details.entity_profile)}
            </div>
          </div>
          <div class="detail-section">
            <h5>Matched Aliases (${aliasCount})</h5>
            <div class="candidate-list">
              ${aliasEntries.map(([alias, info]) => `
                <div class="candidate-item">
                  <span class="name">${alias}</span>
                  <span class="method-badge ${info.method}">${info.method}</span>
                  <span class="score">${Math.round((info.confidence || 0) * 100)}%</span>
                </div>
              `).join('') || '<div>No aliases</div>'}
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
          <div class="detail-meta">
            <span>Last updated: ${details.last_updated ? new Date(details.last_updated).toLocaleString() : "N/A"}</span>
          </div>
        </div>
      </div>
    </td>
  `;

  // Replace the target row with expanded row
  targetRow.parentNode.replaceChild(expandedRow, targetRow);

  // Store state for collapse
  expandedRowState = { originalRow, expandedRow };

  // Add collapse handler
  expandedRow.querySelector(".collapse-btn").onclick = (e) => {
    e.stopPropagation();
    collapseExpandedRow();
  };
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

/**
 * Populate history view from cached entries (from backend match_database)
 * Called after history cache is initialized on server reconnection
 * @param {Object} entries - Match database entries {identifier: {aliases, entity_profile, ...}}
 */
export function populateFromCache(entries) {
  if (!entries || Object.keys(entries).length === 0) {
    console.log("[ActivityFeed] No cached entries to populate");
    return;
  }

  if (!tableBody) {
    const initSuccess = init();
    if (!initSuccess || !tableBody) {
      console.warn("[ActivityFeed] Cannot initialize - skipping cache population");
      return;
    }
  }

  // Clear existing placeholder
  const placeholder = tableBody?.querySelector(".placeholder-row");
  if (placeholder) placeholder.remove();

  // Convert entries to flat list of activities sorted by timestamp
  const cachedActivities = [];

  for (const [identifier, entry] of Object.entries(entries)) {
    const aliases = entry.aliases || {};

    for (const [source, aliasInfo] of Object.entries(aliases)) {
      cachedActivities.push({
        source,
        target: identifier,
        method: aliasInfo.method || "unknown",
        confidence: aliasInfo.confidence || 0,
        timestamp: aliasInfo.timestamp,
        isCached: true  // Flag to distinguish from session activities
      });
    }
  }

  // Sort by timestamp descending (newest first)
  cachedActivities.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeB - timeA;
  });

  // Limit to maxEntries
  const toDisplay = cachedActivities.slice(0, maxEntries);

  // Add rows to table
  for (const activity of toDisplay) {
    const { source, target, method, confidence, timestamp } = activity;

    const displayTime = timestamp
      ? new Date(timestamp).toLocaleTimeString()
      : "-";

    const row = document.createElement("tr");
    row.className = `activity-row ${method} cached-entry`;
    row.dataset.identifier = target || "";
    row.innerHTML = `
      <td class="time">${displayTime}</td>
      <td class="source">${source || "-"}</td>
      <td class="target">${target?.substring(0, 40) || "-"}${target?.length > 40 ? "..." : ""}</td>
      <td class="method">${method?.toUpperCase() || "-"}</td>
      <td class="confidence">${confidence ? Math.round(confidence * 100) + "%" : "-"}</td>
    `;

    // Make row clickable to show details in-place
    row.style.cursor = "pointer";
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      fetchAndDisplayDetails(target, row);
    });

    tableBody.appendChild(row);
  }

  console.log(`[ActivityFeed] Populated ${toDisplay.length} entries from cache`);
  updateHistoryTabCounter();
}
