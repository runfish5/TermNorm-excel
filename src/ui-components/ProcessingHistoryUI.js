import { buildActivityRow } from "./activity-row-builder.js";
import { addEvent, clearEvents, getCount as getEventCount, getMaxEntries } from "../services/event-log.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

let container = null;
let tableBody = null;

// Track expanded row state for collapse/restore
let expandedRowState = null; // { originalRow, expandedRow }

// CHECKPOINT 5: Listen to history cache initialization event
eventBus.on(Events.HISTORY_CACHE_INITIALIZED, ({ entries }) => {
  console.log("[ProcessingHistory] Received cache initialization event");
  populateFromCache(entries);
});

export function init(containerId = "processing-history-feed") {
  container = document.getElementById(containerId);
  if (!container) {
    console.warn(`ProcessingHistory: Container '${containerId}' not found - will try lazy init`);
    return false;
  }

  // Check if already initialized (tableBody exists and is still in DOM)
  if (tableBody && tableBody.isConnected) {
    return true;
  }

  container.innerHTML = `<table class="table table-rounded table-elevated">
<thead><tr><th>Time</th><th>Source</th><th>Target</th><th>Method</th><th>Confidence</th></tr></thead>
<tbody></tbody></table>`;

  tableBody = container?.querySelector("tbody");

  const clearBtn = document.getElementById("clear-history");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => clear());
  }

  showPlaceholder();
  return true;
}

export async function addEntry(source, cellKey, timestamp, result) {
  if (!tableBody && (!init() || !tableBody)) {
    console.warn("ProcessingHistory: Cannot initialize");
    return;
  }

  try {
    // Remove placeholder if present
    const placeholder = tableBody?.querySelector(".placeholder-row");
    if (placeholder) placeholder.remove();

    // Store event in event log
    addEvent({ source, cellKey, timestamp });

    // Use passed result directly (normalized result from match methods)
    const displayResult = result || {
      target: "Unknown",
      method: "-",
      confidence: 0,
      timestamp: timestamp,
      web_search_status: "idle",
    };

    // Cache entity (unifies session and cached data)
    const { cacheEntity } = await import("../services/entity-cache.js");
    cacheEntity(source, displayResult);

    // Create row using shared builder
    const row = buildActivityRow({ source, sessionKey: cellKey, timestamp }, displayResult);
    tableBody.insertBefore(row, tableBody.firstChild);

    // Make row clickable (same as cached entries)
    row.style.cursor = "pointer";
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      fetchAndDisplayDetails(displayResult.target, row);
    });

    // Remove excess rows if over maxEntries (event log already maintains limit)
    const maxEntries = getMaxEntries();
    while (tableBody.children.length > maxEntries) {
      tableBody.removeChild(tableBody.lastChild);
    }

    updateHistoryTabCounter();
  } catch (error) {
    console.error("ProcessingHistory.addEntry() error:", error);
  }
}

export function clear() {
  if (!tableBody) return;
  clearEvents(); // Clear event log
  tableBody.innerHTML = "";
  showPlaceholder();
  updateHistoryTabCounter();
}

/**
 * Scroll to and highlight entry matching the given key
 * @param {string} key - Session key or identifier to find
 * @param {string} [type="sessionKey"] - Type of key: "sessionKey" or "identifier"
 * @returns {HTMLElement|null} The target row element, or null if not found
 */
export function scrollToAndHighlight(key, type = "sessionKey") {
  if (!tableBody || !key) return null;

  // Find row by data attribute (works for both session and cached entries)
  const selector =
    type === "identifier" ? `[data-identifier="${CSS.escape(key)}"]` : `[data-session-key="${CSS.escape(key)}"]`;

  let targetRow = tableBody.querySelector(selector);

  // Fallback: try the other type if not found
  if (!targetRow && type === "sessionKey") {
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
  if (tableBody && !tableBody.querySelector(".history-row"))
    tableBody.innerHTML = '<tr class="placeholder-row"><td colspan="5">No activity yet. Start tracking.</td></tr>';
}

function collapseExpandedRow() {
  if (!expandedRowState) return;
  const { originalRow, expandedRow } = expandedRowState;
  if (expandedRow?.parentNode && originalRow) {
    expandedRow.parentNode.replaceChild(originalRow, expandedRow);
    const id = originalRow.dataset.identifier;
    if (id) {
      originalRow.style.cursor = "pointer";
      originalRow.addEventListener("click", (e) => {
        e.stopPropagation();
        fetchAndDisplayDetails(id, originalRow);
      });
    }
  }
  expandedRowState = null;
}

export function updateHistoryTabCounter() {
  const historyTab = document.getElementById("history-tab");
  if (historyTab && tableBody) {
    const historyRows = tableBody.querySelectorAll(".history-row");
    const count = historyRows.length;
    const tabIcon = historyTab.querySelector(".tab-icon");
    if (tabIcon) {
      tabIcon.textContent = `${count}📜`;
    }
  }
}

export function getCount() {
  return getEventCount();
}

/**
 * Handle cell selection from Excel - switch to history tab, scroll to entry, show details
 * @param {string|null} cellKey - Cell key (row:col format) for current session
 * @param {Object|null} state - Cell state from cellState Map
 * @param {string|null} identifier - Identifier (target) for lookup
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

  // Try to scroll to entry - first by sessionKey, then by identifier
  let targetRow = null;
  if (cellKey) {
    targetRow = scrollToAndHighlight(cellKey, "sessionKey");
  }
  if (!targetRow && lookupIdentifier) {
    targetRow = scrollToAndHighlight(lookupIdentifier, "identifier");
  }

  // Show details in-place if we found the row
  if (lookupIdentifier && targetRow) {
    await fetchAndDisplayDetails(lookupIdentifier, targetRow);
  }
}

// Fetch entity details - uses entity cache abstraction
async function fetchAndDisplayDetails(identifier, targetRow) {
  const { getEntity } = await import("../services/entity-cache.js");

  const entry = await getEntity(identifier);

  if (!entry) {
    console.warn("No entity found for:", identifier);
    return;
  }

  console.log("[ProcessingHistory] Showing details for:", identifier.substring(0, 40));
  displayDetailsPanel({ identifier, ...entry }, targetRow);
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
  expandedRow.className = "history-row expanded-details";
  expandedRow.dataset.identifier = details.identifier || "";

  expandedRow.innerHTML = `<td colspan="5" class="details-cell">
  <div class="inline-details-panel">
    <div class="details-header">
      <div class="details-title"><strong>Target:</strong> ${details.identifier || "Unknown"}</div>
      <button class="btn-collapse" title="Collapse">▲</button>
    </div>
    <div class="details-content">
      <div class="detail-section">
        <h5>Entity Profile</h5>
        <div class="card-sm card-muted">${formatEntityProfile(details.entity_profile)}</div>
      </div>
      <div class="detail-section">
        <h5>Matched Aliases (${aliasCount})</h5>
        <div class="card-sm card-muted">${
          aliasEntries
            .map(
              ([alias, info]) =>
                `<div class="list-item-bordered"><span class="name">${alias}</span><span class="badge badge-sm badge-uppercase ${info.method}">${info.method}</span><span class="score">${Math.round((info.confidence || 0) * 100)}%</span></div>`
            )
            .join("") || "<div>No aliases</div>"
        }</div>
      </div>
      <div class="detail-section">
        <h5>Web Sources (${details.web_sources?.length || 0})</h5>
        <ul class="list-plain list-scrollable">${
          details.web_sources
            ?.map((s) => `<li><a href="${s.url || s}" target="_blank">${s.title || s.url || s}</a></li>`)
            .join("") || "<li>No sources</li>"
        }</ul>
      </div>
      <div class="detail-meta">
        <span>Last updated: ${details.last_updated ? new Date(details.last_updated).toLocaleString() : "N/A"}</span>
      </div>
    </div>
  </div>
</td>`;

  // Replace the target row with expanded row
  targetRow.parentNode.replaceChild(expandedRow, targetRow);

  // Store state for collapse
  expandedRowState = { originalRow, expandedRow };

  // Add collapse handler
  expandedRow.querySelector(".btn-collapse").onclick = (e) => {
    e.stopPropagation();
    collapseExpandedRow();
  };
}

function formatEntityProfile(profile) {
  if (!profile) return "<p>No profile</p>";
  return `<div class="profile-field"><strong>Name:</strong> ${profile.entity_name || profile.name || "N/A"}</div>
<div class="profile-field"><strong>Core Concept:</strong> ${profile.core_concept || "N/A"}</div>
<div class="profile-field"><strong>Key Features:</strong> ${profile.distinguishing_features?.slice(0, 5).join(", ") || profile.key_features?.join(", ") || "N/A"}</div>`;
}

/**
 * Populate history view from cached entities (from backend match_database)
 * Called after entity cache is initialized on server reconnection
 * @param {Object} entries - Entity database entries {identifier: {aliases, entity_profile, ...}}
 */
export function populateFromCache(entries) {
  if (!entries || Object.keys(entries).length === 0) {
    console.log("[ProcessingHistory] No cached entries to populate");
    return;
  }

  if (!tableBody && (!init() || !tableBody)) {
    console.warn("[ProcessingHistory] Cannot initialize");
    return;
  }

  // Clear existing placeholder
  const placeholder = tableBody?.querySelector(".placeholder-row");
  if (placeholder) placeholder.remove();

  // Convert entries to flat list of events sorted by timestamp
  const cachedEvents = [];

  for (const [identifier, entry] of Object.entries(entries)) {
    for (const [source, aliasInfo] of Object.entries(entry.aliases || {})) {
      cachedEvents.push({
        source,
        target: identifier,
        method: aliasInfo.method || "unknown",
        confidence: aliasInfo.confidence || 0,
        timestamp: aliasInfo.timestamp,
        isCached: true,
      });
    }
  }

  // Sort by timestamp descending (newest first)
  cachedEvents.sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeB - timeA;
  });

  // Limit to maxEntries
  const toDisplay = cachedEvents.slice(0, getMaxEntries());

  // Add rows to table
  for (const event of toDisplay) {
    const { source, target, method, confidence, timestamp } = event;

    // Create row using shared builder
    const row = buildActivityRow(
      { source, sessionKey: null, timestamp }, // No session key for cached entries
      { target, method, confidence, web_search_status: "idle" }
    );

    // Add cached-entry class
    row.classList.add("cached-entry");

    // Make row clickable to show details in-place
    row.style.cursor = "pointer";
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      fetchAndDisplayDetails(target, row);
    });

    tableBody.appendChild(row);
  }

  console.log(`[ProcessingHistory] Populated ${toDisplay.length} entries from cache`);
  updateHistoryTabCounter();
}
