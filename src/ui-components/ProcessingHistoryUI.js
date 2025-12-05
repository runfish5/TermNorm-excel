import { buildActivityRow } from "./activity-row-builder.js";
import { addEvent, clearEvents, getMaxEntries } from "../services/event-log.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

let container = null, tableBody = null, expandedRowState = null;

eventBus.on(Events.HISTORY_CACHE_INITIALIZED, ({ entries }) => populateFromCache(entries));
eventBus.on(Events.CELL_SELECTED, async ({ cellKey, state, identifier }) => handleCellSelection(cellKey, state, identifier));

export function init(containerId = "processing-history-feed") {
  container = document.getElementById(containerId);
  if (!container) return false;
  if (tableBody?.isConnected) return true;

  container.innerHTML = `<table class="table table-rounded table-elevated"><thead><tr><th>Time</th><th>Source</th><th>Target</th><th>Method</th><th>Confidence</th></tr></thead><tbody></tbody></table>`;
  tableBody = container?.querySelector("tbody");

  document.getElementById("clear-history")?.addEventListener("click", clear);
  showPlaceholder();
  return true;
}

export async function addEntry(source, cellKey, timestamp, result) {
  if (!tableBody && (!init() || !tableBody)) return;

  try {
    tableBody?.querySelector(".placeholder-row")?.remove();
    addEvent({ source, cellKey, timestamp });

    const displayResult = result || { target: "Unknown", method: "-", confidence: 0, timestamp, web_search_status: "idle" };
    const { cacheEntity } = await import("../utils/history-cache.js");
    cacheEntity(source, displayResult);

    const row = buildActivityRow({ source, sessionKey: cellKey, timestamp }, displayResult);
    tableBody.insertBefore(row, tableBody.firstChild);

    row.classList.add("cursor-pointer");
    row.addEventListener("click", (e) => { e.stopPropagation(); fetchAndDisplayDetails(displayResult.target, row); });

    const maxEntries = getMaxEntries();
    while (tableBody.children.length > maxEntries) tableBody.removeChild(tableBody.lastChild);

    updateHistoryTabCounter();
  } catch (error) {
    console.error("ProcessingHistory.addEntry() error:", error);
  }
}

export function clear() {
  if (!tableBody) return;
  clearEvents();
  tableBody.innerHTML = "";
  showPlaceholder();
  updateHistoryTabCounter();
}

export function scrollToAndHighlight(key, type = "sessionKey") {
  if (!tableBody || !key) return null;

  const attr = type === "identifier" ? "data-identifier" : "data-session-key";
  let targetRow = tableBody.querySelector(`[${attr}="${CSS.escape(key)}"]`);
  if (!targetRow && type === "sessionKey") targetRow = tableBody.querySelector(`[data-identifier="${CSS.escape(key)}"]`);
  if (!targetRow) return null;

  collapseExpandedRow();
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
      originalRow.classList.add("cursor-pointer");
      originalRow.addEventListener("click", (e) => { e.stopPropagation(); fetchAndDisplayDetails(id, originalRow); });
    }
  }
  expandedRowState = null;
}

export function updateHistoryTabCounter() {
  const historyTab = document.getElementById("history-tab");
  if (historyTab && tableBody) {
    const count = tableBody.querySelectorAll(".history-row").length;
    const tabIcon = historyTab.querySelector(".tab-icon");
    if (tabIcon) tabIcon.textContent = `${count}📜`;
  }
}

export async function handleCellSelection(cellKey, state, identifier) {
  const { showView } = await import("./view-manager.js");
  showView("history");

  const lookupId = identifier || state?.result?.target;
  let targetRow = cellKey ? scrollToAndHighlight(cellKey, "sessionKey") : null;
  if (!targetRow && lookupId) targetRow = scrollToAndHighlight(lookupId, "identifier");
  if (lookupId && targetRow) await fetchAndDisplayDetails(lookupId, targetRow);
}

async function fetchAndDisplayDetails(identifier, targetRow) {
  const { getEntity } = await import("../utils/history-cache.js");
  const entry = await getEntity(identifier);
  if (entry) displayDetailsPanel({ identifier, ...entry }, targetRow);
}

function displayDetailsPanel(details, targetRow) {
  if (!details || !targetRow) return;
  collapseExpandedRow();

  if (!targetRow.isConnected && details.identifier) {
    targetRow = tableBody?.querySelector(`[data-identifier="${CSS.escape(details.identifier)}"]`);
    if (!targetRow) return;
  }

  const originalRow = targetRow.cloneNode(true);
  const aliases = Object.entries(details.aliases || {});

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
      <div class="detail-section"><h5>Entity Profile</h5><div class="card-sm card-muted">${formatEntityProfile(details.entity_profile)}</div></div>
      <div class="detail-section"><h5>Matched Aliases (${aliases.length})</h5><div class="card-sm card-muted">${aliases.map(([alias, info]) => `<div class="list-item-bordered"><span class="name">${alias}</span><span class="badge badge-sm badge-uppercase ${info.method}">${info.method}</span><span class="score">${Math.round((info.confidence || 0) * 100)}%</span></div>`).join("") || "<div>No aliases</div>"}</div></div>
      <div class="detail-section"><h5>Web Sources (${details.web_sources?.length || 0})</h5><ul class="list-plain list-scrollable">${details.web_sources?.map((s) => `<li><a href="${s.url || s}" target="_blank">${s.title || s.url || s}</a></li>`).join("") || "<li>No sources</li>"}</ul></div>
      <div class="detail-meta"><span>Last updated: ${details.last_updated ? new Date(details.last_updated).toLocaleString() : "N/A"}</span></div>
    </div>
  </div>
</td>`;

  targetRow.parentNode.replaceChild(expandedRow, targetRow);
  expandedRowState = { originalRow, expandedRow };
  expandedRow.querySelector(".btn-collapse").onclick = (e) => { e.stopPropagation(); collapseExpandedRow(); };
}

function formatEntityProfile(profile) {
  if (!profile) return "<p>No profile</p>";
  return `<div class="profile-field"><strong>Name:</strong> ${profile.entity_name || profile.name || "N/A"}</div>
<div class="profile-field"><strong>Core Concept:</strong> ${profile.core_concept || "N/A"}</div>
<div class="profile-field"><strong>Key Features:</strong> ${profile.distinguishing_features?.slice(0, 5).join(", ") || profile.key_features?.join(", ") || "N/A"}</div>`;
}

export function populateFromCache(entries) {
  if (!entries || !Object.keys(entries).length) return;
  if (!tableBody && (!init() || !tableBody)) return;

  tableBody?.querySelector(".placeholder-row")?.remove();

  const cachedEvents = [];
  for (const [identifier, entry] of Object.entries(entries)) {
    for (const [source, info] of Object.entries(entry.aliases || {})) {
      cachedEvents.push({ source, target: identifier, method: info.method || "unknown", confidence: info.confidence || 0, timestamp: info.timestamp });
    }
  }

  cachedEvents.sort((a, b) => (b.timestamp ? new Date(b.timestamp).getTime() : 0) - (a.timestamp ? new Date(a.timestamp).getTime() : 0));

  for (const { source, target, method, confidence, timestamp } of cachedEvents.slice(0, getMaxEntries())) {
    const row = buildActivityRow({ source, sessionKey: null, timestamp }, { target, method, confidence, web_search_status: "idle" });
    row.classList.add("cached-entry", "cursor-pointer");
    row.addEventListener("click", (e) => { e.stopPropagation(); fetchAndDisplayDetails(target, row); });
    tableBody.appendChild(row);
  }

  updateHistoryTabCounter();
}
