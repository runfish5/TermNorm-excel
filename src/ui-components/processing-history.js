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

function addClickHandler(row, target) {
  row.classList.add("cursor-pointer");
  row.addEventListener("click", (e) => { e.stopPropagation(); fetchAndDisplayDetails(target, row); });
}

export async function addEntry(source, cellKey, timestamp, result) {
  if (!tableBody && (!init() || !tableBody)) return;
  tableBody?.querySelector(".placeholder-row")?.remove();
  addEvent({ source, cellKey, timestamp });
  const r = result || { target: "Unknown", method: "-", confidence: 0, timestamp, web_search_status: "idle" };
  const { cacheEntity } = await import("../utils/history-cache.js");
  cacheEntity(source, r);
  const row = buildActivityRow({ source, sessionKey: cellKey, timestamp }, r);
  tableBody.insertBefore(row, tableBody.firstChild);
  addClickHandler(row, r.target);
  while (tableBody.children.length > getMaxEntries()) tableBody.removeChild(tableBody.lastChild);
  updateHistoryTabCounter();
}

export function clear() {
  if (!tableBody) return;
  clearEvents(); tableBody.innerHTML = ""; showPlaceholder(); updateHistoryTabCounter();
}

export function scrollToAndHighlight(key, type = "sessionKey") {
  if (!tableBody || !key) return null;
  const attr = type === "identifier" ? "data-identifier" : "data-session-key";
  const row = tableBody.querySelector(`[${attr}="${CSS.escape(key)}"]`) || (type === "sessionKey" ? tableBody.querySelector(`[data-identifier="${CSS.escape(key)}"]`) : null);
  if (!row) return null;
  collapseExpandedRow();
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  return row;
}

function showPlaceholder() {
  if (tableBody && !tableBody.querySelector(".history-row")) tableBody.innerHTML = '<tr class="placeholder-row"><td colspan="5">No activity yet. Start tracking.</td></tr>';
}

function collapseExpandedRow() {
  if (!expandedRowState) return;
  const { originalRow, expandedRow } = expandedRowState;
  if (expandedRow?.parentNode && originalRow) {
    expandedRow.parentNode.replaceChild(originalRow, expandedRow);
    if (originalRow.dataset.identifier) addClickHandler(originalRow, originalRow.dataset.identifier);
  }
  expandedRowState = null;
}

export function updateHistoryTabCounter() {
  const tabIcon = document.getElementById("history-tab")?.querySelector(".tab-icon");
  if (tabIcon && tableBody) tabIcon.textContent = `${tableBody.querySelectorAll(".history-row").length}📜`;
}

export async function handleCellSelection(cellKey, state, identifier) {
  (await import("../utils/dom-helpers.js")).showView("history");
  const id = identifier || state?.result?.target;
  const row = (cellKey && scrollToAndHighlight(cellKey, "sessionKey")) || (id && scrollToAndHighlight(id, "identifier"));
  if (id && row) fetchAndDisplayDetails(id, row);
}

async function fetchAndDisplayDetails(identifier, row) {
  const entry = await (await import("../utils/history-cache.js")).getEntity(identifier);
  if (entry) displayDetailsPanel({ identifier, ...entry }, row);
}

function displayDetailsPanel(d, row) {
  if (!d || !row) return;
  collapseExpandedRow();
  if (!row.isConnected && d.identifier) row = tableBody?.querySelector(`[data-identifier="${CSS.escape(d.identifier)}"]`);
  if (!row) return;

  const aliases = Object.entries(d.aliases || {}), p = d.entity_profile;
  const profile = p ? `<div><strong>Name:</strong> ${p.entity_name || p.name || "N/A"}</div><div><strong>Core:</strong> ${p.core_concept || "N/A"}</div><div><strong>Features:</strong> ${p.distinguishing_features?.slice(0, 5).join(", ") || p.key_features?.join(", ") || "N/A"}</div>` : "<p>No profile</p>";
  const aliasHTML = aliases.map(([a, i]) => `<div class="list-item-bordered"><span>${a}</span><span class="badge badge-sm ${i.method}">${i.method}</span><span>${Math.round((i.confidence || 0) * 100)}%</span></div>`).join("") || "<div>None</div>";
  const srcHTML = d.web_sources?.map(s => `<li><a href="${s.url || s}" target="_blank">${s.title || s.url || s}</a></li>`).join("") || "<li>None</li>";

  const tr = document.createElement("tr");
  tr.className = "history-row expanded-details";
  tr.dataset.identifier = d.identifier || "";
  tr.innerHTML = `<td colspan="5" class="details-cell"><div class="inline-details-panel"><div class="details-header"><div class="details-title"><strong>Target:</strong> ${d.identifier || "?"}</div><button class="btn-collapse">▲</button></div><div class="details-content"><div class="detail-section"><h5>Profile</h5><div class="card-sm card-muted">${profile}</div></div><div class="detail-section"><h5>Aliases (${aliases.length})</h5><div class="card-sm card-muted">${aliasHTML}</div></div><div class="detail-section"><h5>Sources (${d.web_sources?.length || 0})</h5><ul class="list-plain list-scrollable">${srcHTML}</ul></div><div class="detail-meta">${d.last_updated ? new Date(d.last_updated).toLocaleString() : ""}</div></div></div></td>`;

  row.parentNode.replaceChild(tr, row);
  expandedRowState = { originalRow: row.cloneNode(true), expandedRow: tr };
  tr.querySelector(".btn-collapse").onclick = (e) => { e.stopPropagation(); collapseExpandedRow(); };
}

export function populateFromCache(entries) {
  if (!entries || !Object.keys(entries).length || (!tableBody && !init())) return;
  tableBody?.querySelector(".placeholder-row")?.remove();

  const events = Object.entries(entries).flatMap(([id, e]) => Object.entries(e.aliases || {}).map(([src, i]) => ({ source: src, target: id, method: i.method || "unknown", confidence: i.confidence || 0, timestamp: i.timestamp })));
  events.sort((a, b) => (b.timestamp ? new Date(b.timestamp) : 0) - (a.timestamp ? new Date(a.timestamp) : 0));

  for (const { source, target, method, confidence, timestamp } of events.slice(0, getMaxEntries())) {
    const row = buildActivityRow({ source, sessionKey: null, timestamp }, { target, method, confidence, web_search_status: "idle" });
    row.classList.add("cached-entry");
    addClickHandler(row, target);
    tableBody.appendChild(row);
  }
  updateHistoryTabCounter();
}
