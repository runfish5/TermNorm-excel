import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { EVENT_LOG } from "../config/config.js";

// Event log (inlined from event-log.js)
const sessionEvents = [];
const addEvent = (e) => { if (!e.source) return null; e.timestamp = e.timestamp || new Date().toISOString(); sessionEvents.unshift(e); if (sessionEvents.length > EVENT_LOG.MAX_ENTRIES) sessionEvents.pop(); return e; };
const clearEvents = () => { sessionEvents.length = 0; };

let container = null, tableBody = null, expandedRowState = null;

// Source index: deduplicate rows by source value
// Map<source, {row: HTMLElement, history: [{timestamp, target, method, confidence, web_search_status}, ...]}>
const sourceIndex = new Map();

/** Normalize source key for consistent lookup (handles whitespace, case, unicode) */
function normalizeSourceKey(source) {
  return String(source || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")           // Collapse multiple spaces
    .normalize("NFC");              // Unicode normalization
}

/** Insert a history entry in timestamp-sorted order (newest first) */
function insertHistorySorted(history, newEntry) {
  const newTime = new Date(newEntry.timestamp || 0).getTime();
  let i = 0;
  while (i < history.length && new Date(history[i].timestamp || 0).getTime() > newTime) {
    i++;
  }
  history.splice(i, 0, newEntry);
  return i === 0; // Returns true if this is now the newest entry
}

/** Find the source with the oldest most-recent activity for eviction */
function findOldestSource() {
  let oldestKey = null, oldestTime = Infinity;
  for (const [key, entry] of sourceIndex) {
    const latestTs = new Date(entry.history[0]?.timestamp || 0).getTime();
    if (latestTs < oldestTime) {
      oldestTime = latestTs;
      oldestKey = key;
    }
  }
  return oldestKey;
}

/** Build activity table row from normalized result data */
function buildActivityRow({ source, sessionKey, timestamp }, { target, method, confidence, web_search_status }, historyCount = 1) {
  const displayTime = new Date(timestamp || Date.now()).toLocaleTimeString();
  const methodText = web_search_status === "failed" && method === "ProfileRank"
    ? `⚠️ ${method.toUpperCase()} (web scrape ∅)`
    : (method?.toUpperCase() || "-");
  const row = document.createElement("tr");
  row.className = `history-row ${method}`;
  row.dataset.sessionKey = sessionKey || "";
  row.dataset.identifier = target || "";
  row.dataset.source = source || "";
  const historyIndicator = historyCount > 1 ? ` <span class="history-count" title="Click to see ${historyCount} entries">🕐${historyCount}</span>` : "";
  row.innerHTML = `
    <td class="time">${displayTime}${historyIndicator}</td>
    <td class="source">${source || "-"}</td>
    <td class="target">${target || "-"}</td>
    <td class="method">${methodText}</td>
    <td class="confidence">${method !== "error" && confidence ? Math.round(confidence * 100) + "%" : "-"}</td>`;
  return row;
}

/** Update existing row content with new data */
function updateRowContent(row, { source, timestamp }, { target, method, confidence, web_search_status }, historyCount) {
  const displayTime = new Date(timestamp || Date.now()).toLocaleTimeString();
  const methodText = web_search_status === "failed" && method === "ProfileRank"
    ? `⚠️ ${method.toUpperCase()} (web scrape ∅)`
    : (method?.toUpperCase() || "-");
  row.className = `history-row ${method}`;
  row.dataset.identifier = target || "";
  const historyIndicator = historyCount > 1 ? ` <span class="history-count" title="Click to see ${historyCount} entries">🕐${historyCount}</span>` : "";
  row.innerHTML = `
    <td class="time">${displayTime}${historyIndicator}</td>
    <td class="source">${source || "-"}</td>
    <td class="target">${target || "-"}</td>
    <td class="method">${methodText}</td>
    <td class="confidence">${method !== "error" && confidence ? Math.round(confidence * 100) + "%" : "-"}</td>`;
}

/** Show history popup for a source */
function showHistoryPopup(source, history, currentRow) {
  // Remove existing popup
  document.querySelector(".history-popup")?.remove();

  if (!history || history.length <= 1) return;

  const popup = document.createElement("div");
  popup.className = "history-popup card card-elevated";
  popup.innerHTML = `
    <div class="history-popup-header">
      <strong>History for: ${source}</strong>
      <button class="btn-close">×</button>
    </div>
    <div class="history-popup-content">
      ${history.map((h, i) => `
        <div class="history-popup-item ${i === 0 ? 'current' : ''}" data-index="${i}" data-target="${h.target}">
          <span class="time">${new Date(h.timestamp).toLocaleString()}</span>
          <span class="target">${h.target}</span>
          <span class="badge badge-sm ${h.method}">${h.method}</span>
          <span>${Math.round((h.confidence || 0) * 100)}%</span>
          ${i === 0 ? '<span class="current-indicator">★</span>' : '<span class="view-btn">→</span>'}
        </div>
      `).join("")}
    </div>`;

  (document.getElementById("app-body") || document.body).appendChild(popup);
  popup.querySelector(".btn-close").onclick = () => popup.remove();

  // Make items clickable to view details for that target
  popup.querySelectorAll(".history-popup-item").forEach(item => {
    item.style.cursor = "pointer";
    item.onclick = async (e) => {
      e.stopPropagation();
      const target = item.dataset.target;
      if (target && currentRow) {
        popup.remove();
        fetchAndDisplayDetails(target, currentRow);
      }
    };
  });

  // Close on click outside
  setTimeout(() => {
    const closeHandler = (e) => {
      if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener("click", closeHandler); }
    };
    document.addEventListener("click", closeHandler);
  }, 100);
}

eventBus.on(Events.HISTORY_CACHE_INITIALIZED, ({ entries }) => populateFromCache(entries));
eventBus.on(Events.CELL_SELECTED, async ({ cellKey, state, identifier, source }) => handleCellSelection(cellKey, state, identifier, source));
eventBus.on(Events.MATCH_LOGGED, ({ value, cellKey, timestamp, result }) => addEntry(value, cellKey, timestamp, result));

export function init(containerId = "processing-history-feed") {
  container = document.getElementById(containerId);
  if (!container) return false;
  if (tableBody?.isConnected) return true;
  // Clear stale state when reinitializing
  sourceIndex.clear();
  container.innerHTML = `
    <table class="table table-rounded table-elevated">
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
    </table>`;
  tableBody = container?.querySelector("tbody");
  document.getElementById("clear-history")?.addEventListener("click", clear);
  showPlaceholder();
  return true;
}

const addClickHandler = (row, target, source) => {
  row.classList.add("cursor-pointer");
  row.onclick = e => { e.stopPropagation(); fetchAndDisplayDetails(target, row); };
  // Add click handler for history count
  const historySpan = row.querySelector(".history-count");
  if (historySpan && source) {
    historySpan.onclick = (e) => {
      e.stopPropagation();
      const sourceKey = String(source).trim().toLowerCase();
      const entry = sourceIndex.get(sourceKey);
      if (entry?.history) showHistoryPopup(source, entry.history, row);
    };
  }
};

export async function addEntry(source, cellKey, timestamp, result) {
  try {
    if (!source) return;
    if (!tableBody?.isConnected) {
      if (!init()) {
        console.warn("[History] init failed, container may not exist");
        return;
      }
    }
    tableBody.querySelector(".placeholder-row")?.remove();
    const ts = timestamp || new Date().toISOString();
    // Normalize source key for consistent lookup
    const sourceKey = String(source).trim().toLowerCase();
    addEvent({ source, cellKey, timestamp: ts });
    const r = result || { target: "Unknown", method: "-", confidence: 0, timestamp: ts, web_search_status: "idle" };
    try {
      (await import("../utils/history-cache.js")).cacheEntity(source, r);
    } catch (cacheErr) {
      console.warn("[History] Cache update failed:", cacheErr);
    }

    const existing = sourceIndex.get(sourceKey);
    const historyEntry = { timestamp: ts, target: r.target, method: r.method, confidence: r.confidence, web_search_status: r.web_search_status || "idle" };
    let activeRow;
    if (existing) {
      // Update existing row - insert in sorted order
      insertHistorySorted(existing.history, historyEntry);
      // Always move to top when any event occurs for this source
      tableBody.insertBefore(existing.row, tableBody.firstChild);
      // Always update row content to show latest entry and correct history count
      const latest = existing.history[0];
      updateRowContent(existing.row, { source, timestamp: latest.timestamp }, { target: latest.target, method: latest.method, confidence: latest.confidence, web_search_status: latest.web_search_status }, existing.history.length);
      addClickHandler(existing.row, latest.target, source);
      activeRow = existing.row;
    } else {
      // Create new row - use normalized key for consistency
      const row = buildActivityRow({ source, sessionKey: cellKey, timestamp: ts }, r, 1);
      sourceIndex.set(sourceKey, { row, history: [historyEntry] });
      tableBody.insertBefore(row, tableBody.firstChild);
      addClickHandler(row, r.target, source);
      activeRow = row;
    }

    // Scroll the new/updated row into view
    activeRow?.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // Trim excess entries (by unique sources, not total rows)
    while (sourceIndex.size > EVENT_LOG.MAX_ENTRIES) {
      const oldestSource = findOldestSource();
      if (!oldestSource) break;
      const entry = sourceIndex.get(oldestSource);
      if (entry?.row) entry.row.remove();
      sourceIndex.delete(oldestSource);
    }

    updateHistoryTabCounter();
  } catch (e) {
    console.error("[History] addEntry error:", e);
    // Show error in table if possible
    if (tableBody?.isConnected) {
      const errRow = document.createElement("tr");
      errRow.className = "history-row error";
      errRow.innerHTML = `<td colspan="5" style="color: var(--error-text); text-align: center; padding: 12px;">Error adding entry: ${source}</td>`;
      tableBody.insertBefore(errRow, tableBody.firstChild);
    }
  }
}

export function clear() {
  if (!tableBody) return;
  clearEvents();
  sourceIndex.clear();
  tableBody.innerHTML = "";
  showPlaceholder();
  updateHistoryTabCounter();
}

function scrollToAndHighlight(key, type = "sessionKey") {
  if (!tableBody || !key) return null;
  const attr = type === "identifier" ? "data-identifier" : type === "source" ? "data-source" : "data-session-key";
  const esc = CSS.escape(key);
  const row = tableBody.querySelector(`[${attr}="${esc}"]`) || (type === "sessionKey" && tableBody.querySelector(`[data-identifier="${esc}"]`));
  if (row) { collapseExpandedRow(); row.scrollIntoView({ behavior: "smooth", block: "center" }); }
  return row || null;
}

const showPlaceholder = () => tableBody && !tableBody.querySelector(".history-row") && (tableBody.innerHTML = '<tr class="placeholder-row"><td colspan="5">No matches yet. Start tracking.</td></tr>');

function collapseExpandedRow() {
  if (!expandedRowState) return;
  const { originalRow, expandedRow, source } = expandedRowState;
  if (expandedRow?.parentNode && originalRow) {
    expandedRow.parentNode.replaceChild(originalRow, expandedRow);
    if (originalRow.dataset.identifier) addClickHandler(originalRow, originalRow.dataset.identifier, source);
  }
  expandedRowState = null;
}

export const updateHistoryTabCounter = () => {
  const t = document.getElementById("history-tab")?.querySelector(".tab-icon");
  if (t) t.textContent = `${sourceIndex.size}📜`;
};

export async function handleCellSelection(cellKey, state, identifier, source) {
  (await import("../utils/dom-helpers.js")).showView("history");
  const id = identifier || state?.result?.target;

  // Prefer lookup by source using sourceIndex (normalized, case-insensitive)
  let row = scrollToAndHighlight(cellKey, "sessionKey");
  if (!row && source) {
    const sourceKey = normalizeSourceKey(source);
    const entry = sourceIndex.get(sourceKey);
    if (entry?.row) {
      collapseExpandedRow();
      entry.row.scrollIntoView({ behavior: "smooth", block: "center" });
      row = entry.row;
    }
  }
  if (!row) row = scrollToAndHighlight(id, "identifier");

  // Get current target from the row's data-identifier (which reflects latest assignment)
  const currentId = row?.dataset?.identifier || id;
  if (currentId && row) fetchAndDisplayDetails(currentId, row);
}

async function fetchAndDisplayDetails(id, row) { const e = await (await import("../utils/history-cache.js")).getEntity(id); if (e) displayDetailsPanel({ identifier: id, ...e }, row); }

function displayDetailsPanel(d, row) {
  if (!d || !row) return;
  collapseExpandedRow();
  if (!row.isConnected && d.identifier) row = tableBody?.querySelector(`[data-identifier="${CSS.escape(d.identifier)}"]`);
  if (!row) return;

  const source = row.dataset.source;
  const aliases = Object.entries(d.aliases || {}), p = d.entity_profile;
  const profile = p ? `
    <div><strong>Name:</strong> ${p.entity_name || p.name || "N/A"}</div>
    <div><strong>Core:</strong> ${p.core_concept || "N/A"}</div>
    <div><strong>Features:</strong> ${p.distinguishing_features?.slice(0, 5).join(", ") || p.key_features?.join(", ") || "N/A"}</div>
  ` : "<p>No profile</p>";
  const aliasHTML = aliases.map(([a, i]) => `
    <div class="list-item-bordered">
      <span>${a}</span>
      <span class="badge badge-sm ${i.method}">${i.method}</span>
      <span>${Math.round((i.confidence || 0) * 100)}%</span>
    </div>
  `).join("") || "<div>None</div>";
  const srcHTML = d.web_sources?.map(s => `
    <li><a href="${s.url || s}" target="_blank">${s.title || s.url || s}</a></li>
  `).join("") || "<li>None</li>";

  const tr = document.createElement("tr");
  tr.className = "history-row expanded-details";
  tr.dataset.identifier = d.identifier || "";
  tr.dataset.source = source || "";
  tr.innerHTML = `
    <td colspan="5" class="details-cell">
      <div class="inline-details-panel">
        <div class="details-header">
          <div class="details-title"><strong>Target:</strong> ${d.identifier || "?"}</div>
          <button class="btn-collapse">▲</button>
        </div>
        <div class="details-content">
          <div class="detail-section">
            <h5>Profile</h5>
            <div class="card-sm card-muted">${profile}</div>
          </div>
          <div class="detail-section">
            <h5>Aliases (${aliases.length})</h5>
            <div class="card-sm card-muted">${aliasHTML}</div>
          </div>
          <div class="detail-section">
            <h5>Sources (${d.web_sources?.length || 0})</h5>
            <ul class="list-plain list-scrollable">${srcHTML}</ul>
          </div>
          <div class="detail-meta">${d.last_updated ? new Date(d.last_updated).toLocaleString() : ""}</div>
        </div>
      </div>
    </td>`;

  row.parentNode.replaceChild(tr, row);
  expandedRowState = { originalRow: row.cloneNode(true), expandedRow: tr, source };
  tr.querySelector(".btn-collapse").onclick = (e) => { e.stopPropagation(); collapseExpandedRow(); };
}

export function populateFromCache(entries) {
  if (!entries || !Object.keys(entries).length || (!tableBody && !init())) return;
  tableBody.querySelector(".placeholder-row")?.remove();

  // Group by normalized source key for consistent lookup
  const bySource = new Map();
  Object.entries(entries).forEach(([id, e]) => {
    Object.entries(e.aliases || {}).forEach(([src, info]) => {
      const srcKey = String(src).trim().toLowerCase();
      if (!bySource.has(srcKey)) bySource.set(srcKey, { displaySource: src, history: [] });
      bySource.get(srcKey).history.push({ target: id, method: info.method || "unknown", confidence: info.confidence || 0, timestamp: info.timestamp, web_search_status: info.web_search_status || "idle" });
    });
  });

  // Sort each source's history by timestamp (newest first)
  bySource.forEach((entry) => {
    entry.history.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  });

  // Sort sources by most recent activity
  const sortedSources = Array.from(bySource.entries())
    .sort((a, b) => new Date(b[1].history[0]?.timestamp || 0) - new Date(a[1].history[0]?.timestamp || 0))
    .slice(0, EVENT_LOG.MAX_ENTRIES);

  // Create one row per source (use normalized key for sourceIndex, display original for UI)
  sortedSources.forEach(([srcKey, entry]) => {
    const latest = entry.history[0];
    const displaySource = entry.displaySource;
    const row = buildActivityRow(
      { source: displaySource, sessionKey: null, timestamp: latest.timestamp },
      { target: latest.target, method: latest.method, confidence: latest.confidence, web_search_status: latest.web_search_status || "idle" },
      entry.history.length
    );
    row.classList.add("cached-entry");
    sourceIndex.set(srcKey, { row, history: entry.history });
    addClickHandler(row, latest.target, displaySource);
    tableBody.appendChild(row);
  });

  updateHistoryTabCounter();
}
