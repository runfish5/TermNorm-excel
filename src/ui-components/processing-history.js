import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { EVENT_LOG } from "../config/config.js";
import { $ } from "../utils/dom-helpers.js";
import { cacheEntity, getEntity } from "../utils/history-cache.js";
import { addSessionHistoryEntry, getStateValue, clearSessionHistory, setSessionHistory } from "../core/state-actions.js";

const sessionEvents = [];
const addEvent = (e) => { if (!e.source) return; e.timestamp = e.timestamp || new Date().toISOString(); sessionEvents.unshift(e); if (sessionEvents.length > EVENT_LOG.MAX_ENTRIES) sessionEvents.pop(); };
const clearEvents = () => { sessionEvents.length = 0; };

let container = null, tableBody = null, expandedRowState = null;
const sourceIndex = new Map(); // Map<normalizedSource, {row, history[], addedAt}>
const AUTO_EXPAND_DELAY_MS = 1500; // Don't auto-expand rows added in the last 1.5 seconds

const norm = (s) => (s || "").trim().toLowerCase();

function insertSorted(arr, entry) {
  const t = new Date(entry.timestamp || 0).getTime();
  let i = 0; while (i < arr.length && new Date(arr[i].timestamp || 0).getTime() > t) i++;
  arr.splice(i, 0, entry);
  return i === 0;
}

function renderRow(row, { source, sessionKey, timestamp }, { target, method, confidence, web_search_status }, historyCount = 1) {
  if (!row) { row = document.createElement("tr"); row.dataset.sessionKey = sessionKey || ""; }
  const t = new Date(timestamp || Date.now()).toLocaleTimeString();
  const m = web_search_status === "failed" && method === "ProfileRank" ? `⚠️ ${method.toUpperCase()} (web scrape ∅)` : (method?.toUpperCase() || "-");
  row.className = `history-row ${method}`; row.dataset.identifier = target || ""; row.dataset.source = source || "";
  const hc = historyCount > 1 ? ` <span class="history-count" title="${historyCount} entries">🕐${historyCount}</span>` : "";
  row.innerHTML = `<td class="time">${t}${hc}</td><td class="source">${source || "-"}</td><td class="target">${target || "-"}</td><td class="method">${m}</td><td class="confidence">${method !== "error" && confidence ? Math.round(confidence * 100) + "%" : "-"}</td>`;
  return row;
}

function showHistoryPopup(source, history, row) {
  document.querySelector(".history-popup")?.remove();
  if (!history || history.length <= 1) return;
  const popup = document.createElement("div");
  popup.className = "history-popup";
  popup.innerHTML = `<div class="history-popup-header"><b>${source}</b> <span class="history-popup-count">(${history.length})</span></div>` +
    history.map((h, i) => `<div data-idx="${i}" class="history-popup-item">
      <span class="history-popup-timestamp">${new Date(h.timestamp).toLocaleString()}</span>
      <span class="history-popup-target">${h.target}</span>
      <span class="history-popup-method">[${h.method}]</span>
      <span>${Math.round((h.confidence||0)*100)}%</span>
      ${i===0?'<span class="history-popup-star">★</span>':'<span class="history-popup-arrow">→</span>'}
    </div>`).join("");
  document.body.appendChild(popup);
  popup.onclick = e => { const t = e.target.closest("[data-idx]"); if (t) { popup.remove(); fetchAndDisplayDetails(history[t.dataset.idx].target, row); } };
  setTimeout(() => document.addEventListener("click", function handler(e) { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener("click", handler); } }), 50);
}

const addClickHandler = (row, target, source) => {
  row.classList.add("cursor-pointer");
  row.onclick = e => { e.stopPropagation(); fetchAndDisplayDetails(target, row); };
  const span = row.querySelector(".history-count");
  if (span && source) span.onclick = e => { e.stopPropagation(); const entry = sourceIndex.get(norm(source)); if (entry?.history) showHistoryPopup(source, entry.history, row); };
};

eventBus.on(Events.HISTORY_CACHE_INITIALIZED, ({ entries }) => populateFromCache(entries));
eventBus.on(Events.CELL_SELECTED, async ({ cellKey, state, identifier, source }) => handleCellSelection(cellKey, state, identifier, source));
eventBus.on(Events.MATCH_LOGGED, ({ value, cellKey, timestamp, result }) => addEntry(value, cellKey, timestamp, result));
eventBus.on(Events.SESSION_HISTORY_CHANGED, () => {
  const sessionHistory = getStateValue('session.sessionHistory') || [];
  if (sessionHistory.length === 0) {
    // State was cleared - clear UI
    clearEvents();
    sourceIndex.clear();
    if (tableBody) { tableBody.innerHTML = ""; showPlaceholder(); }
  }
  updateHistoryTabCounter();
});

export function init(containerId = "processing-history-feed") {
  container = $(containerId);
  if (!container) return false;
  if (tableBody?.isConnected) return true;
  sourceIndex.clear();
  container.innerHTML = `<table class="table table-sm table-rounded table-elevated table-resizable"><thead><tr><th>Time<span class="resize-handle"></span></th><th>Src<span class="resize-handle"></span></th><th>Tgt<span class="resize-handle"></span></th><th>Method<span class="resize-handle"></span></th><th>%</th></tr></thead><tbody></tbody></table>`;
  tableBody = container.querySelector("tbody");
  setupColumnResize(container.querySelector("table"));
  $("clear-history")?.addEventListener("click", clear);
  $("history-options-toggle")?.addEventListener("click", () => {
    $("history-controls")?.classList.toggle("hidden");
  });
  showPlaceholder();
  return true;
}

export async function addEntry(source, cellKey, timestamp, result) {
  if (!source) return;
  if (!tableBody?.isConnected && !init()) return;
  tableBody.querySelector(".placeholder-row")?.remove();
  const ts = timestamp || new Date().toISOString();
  const key = norm(source);
  addEvent({ source, cellKey, timestamp: ts });
  const r = result || { target: "Unknown", method: "-", confidence: 0, web_search_status: "idle" };
  cacheEntity(source, r);
  // Add to centralized state for reactive tab counter
  addSessionHistoryEntry({
    source,
    target: r.target,
    method: r.method,
    confidence: r.confidence,
    timestamp: ts,
    web_search_status: r.web_search_status || "idle"
  });
  const h = { timestamp: ts, target: r.target, method: r.method, confidence: r.confidence, web_search_status: r.web_search_status || "idle" };
  const existing = sourceIndex.get(key);
  if (existing) {
    insertSorted(existing.history, h);
    existing.addedAt = Date.now(); // Update timestamp to prevent auto-expand
    tableBody.insertBefore(existing.row, tableBody.firstChild);
    const latest = existing.history[0];
    renderRow(existing.row, { source, timestamp: latest.timestamp }, latest, existing.history.length);
    addClickHandler(existing.row, latest.target, source);
  } else {
    const row = renderRow(null, { source, sessionKey: cellKey, timestamp: ts }, r, 1);
    sourceIndex.set(key, { row, history: [h], addedAt: Date.now() });
    tableBody.insertBefore(row, tableBody.firstChild);
    addClickHandler(row, r.target, source);
  }
  // Evict oldest source
  while (sourceIndex.size > EVENT_LOG.MAX_ENTRIES) {
    let oldest = null, oldestTime = Infinity;
    for (const [k, e] of sourceIndex) { const t = new Date(e.history[0]?.timestamp || 0).getTime(); if (t < oldestTime) { oldestTime = t; oldest = k; } }
    if (!oldest) break;
    sourceIndex.get(oldest)?.row?.remove();
    sourceIndex.delete(oldest);
  }
  // Tab counter updated reactively via SESSION_HISTORY_CHANGED
}

export function clear() {
  if (!tableBody) return;
  clearEvents();
  sourceIndex.clear();
  tableBody.innerHTML = "";
  showPlaceholder();
  clearSessionHistory(); // Also clear central state
}

function scrollToAndHighlight(key, type = "sessionKey") {
  if (!tableBody || !key) return null;
  const attr = type === "identifier" ? "data-identifier" : type === "source" ? "data-source" : "data-session-key";
  const row = tableBody.querySelector(`[${attr}="${CSS.escape(key)}"]`) || (type === "sessionKey" && tableBody.querySelector(`[data-identifier="${CSS.escape(key)}"]`));
  if (row) { collapseExpandedRow(); row.scrollIntoView({ behavior: "smooth", block: "center" }); }
  return row || null;
}

const showPlaceholder = () => tableBody && !tableBody.querySelector(".history-row") && (tableBody.innerHTML = '<tr class="placeholder-row"><td colspan="5">No matches yet. Start tracking.</td></tr>');

function setupColumnResize(table) {
  const ths = table.querySelectorAll("th");
  ths.forEach(th => {
    const handle = th.querySelector(".resize-handle");
    if (!handle) return;
    let startX, startWidth;
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      startX = e.pageX;
      startWidth = th.offsetWidth;
      const onMouseMove = (e) => {
        const newWidth = Math.max(40, startWidth + e.pageX - startX);
        th.style.width = newWidth + "px";
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  });
}

function collapseExpandedRow() {
  if (!expandedRowState) return;
  const { originalRow, expandedRow, source } = expandedRowState;
  if (expandedRow?.parentNode && originalRow) { expandedRow.parentNode.replaceChild(originalRow, expandedRow); if (originalRow.dataset.identifier) addClickHandler(originalRow, originalRow.dataset.identifier, source); }
  expandedRowState = null;
}

export const updateHistoryTabCounter = () => {
  const t = $("history-tab")?.querySelector(".tab-icon");
  if (t) {
    const count = (getStateValue('session.sessionHistory') || []).length;
    t.textContent = `${count}📜`;
  }
};

export async function handleCellSelection(cellKey, state, identifier, source) {
  if ($("history-view")?.classList.contains("hidden")) return;
  const id = identifier || state?.result?.target;
  let row = scrollToAndHighlight(cellKey, "sessionKey");
  let entry = null;
  if (!row && source) {
    entry = sourceIndex.get(norm(source));
    if (entry?.row) { collapseExpandedRow(); entry.row.scrollIntoView({ behavior: "smooth", block: "center" }); row = entry.row; }
  }
  if (!row) row = scrollToAndHighlight(id, "identifier");
  // Skip auto-expand for recently added rows (let user see the row first)
  // Check entry if found by source, otherwise check by row's source data attribute
  const sourceKey = entry ? null : (row?.dataset?.source ? norm(row.dataset.source) : null);
  const entryToCheck = entry || (sourceKey ? sourceIndex.get(sourceKey) : null);
  if (entryToCheck?.addedAt && Date.now() - entryToCheck.addedAt < AUTO_EXPAND_DELAY_MS) return;
  const currentId = row?.dataset?.identifier || id;
  if (currentId && row) fetchAndDisplayDetails(currentId, row);
}

async function fetchAndDisplayDetails(id, row) { const e = await getEntity(id); if (e) displayDetailsPanel({ identifier: id, ...e }, row); }

function displayDetailsPanel(d, row) {
  if (!d || !row) return;
  collapseExpandedRow();
  if (!row.isConnected && d.identifier) row = tableBody?.querySelector(`[data-identifier="${CSS.escape(d.identifier)}"]`);
  if (!row) return;
  const source = row.dataset.source;
  const aliases = Object.entries(d.aliases || {}), p = d.entity_profile;

  // Aliases: inline chips with color (default) + row view (toggle)
  const aliasInline = aliases.map(([a, i]) => `<span class="alias-chip ${i.method}">${a} <small>${Math.round((i.confidence || 0) * 100)}%</small></span>`).join("") || "<span>None</span>";
  const aliasRows = aliases.map(([a, i]) => `<div class="list-item-bordered"><span>${a}</span><span class="badge badge-sm ${i.method}">${i.method}</span><span>${Math.round((i.confidence || 0) * 100)}%</span></div>`).join("") || "<div>None</div>";

  // Profile (rows)
  const profile = p ? `<div><strong>Name:</strong> ${p.entity_name || p.name || "N/A"}</div><div><strong>Core:</strong> ${p.core_concept || "N/A"}</div><div><strong>Features:</strong> ${p.distinguishing_features?.slice(0, 5).join(", ") || p.key_features?.join(", ") || "N/A"}</div>` : "<div>No profile</div>";

  // Sources (collapsible)
  const srcHTML = d.web_sources?.map(s => `<li><a href="${s.url || s}" target="_blank">${s.title || s.url || s}</a></li>`).join("") || "<li>None</li>";

  const tr = document.createElement("tr");
  tr.className = "history-row expanded-details"; tr.dataset.identifier = d.identifier || ""; tr.dataset.source = source || "";
  tr.innerHTML = `<td colspan="5" class="details-cell-compact"><div class="details-panel-compact card-info">
    <div class="details-row"><div class="target-highlight"><strong>Target:</strong> ${d.identifier || "?"}</div><button class="btn-collapse-sm">▲</button></div>
    <div class="details-row"><span class="details-label">Aliases (${aliases.length})</span><button class="btn-xs btn-ghost alias-toggle" title="Expand">⊞</button></div>
    <div class="aliases-inline">${aliasInline}</div>
    <div class="aliases-rows hidden">${aliasRows}</div>
    <div class="profile-section">${profile}</div>
    <details class="details-collapsible"><summary>Sources (${d.web_sources?.length || 0})</summary><ul class="list-plain list-scrollable">${srcHTML}</ul></details>
  </div></td>`;
  row.parentNode.replaceChild(tr, row);
  expandedRowState = { originalRow: row.cloneNode(true), expandedRow: tr, source };
  tr.querySelector(".btn-collapse-sm").onclick = (e) => { e.stopPropagation(); collapseExpandedRow(); };
  tr.querySelector(".alias-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const inline = tr.querySelector(".aliases-inline");
    const rows = tr.querySelector(".aliases-rows");
    inline.classList.toggle("hidden");
    rows.classList.toggle("hidden");
    e.target.textContent = rows.classList.contains("hidden") ? "⊞" : "⊟";
  });
}

export function populateFromCache(entries) {
  if (!entries || !Object.keys(entries).length || (!tableBody && !init())) return;
  tableBody.querySelector(".placeholder-row")?.remove();
  const bySource = new Map();
  Object.entries(entries).forEach(([id, e]) => {
    Object.entries(e.aliases || {}).forEach(([src, info]) => {
      const k = norm(src);
      if (!bySource.has(k)) bySource.set(k, { displaySource: src, history: [] });
      bySource.get(k).history.push({ target: id, method: info.method || "unknown", confidence: info.confidence || 0, timestamp: info.timestamp, web_search_status: info.web_search_status || "idle" });
    });
  });
  bySource.forEach(e => e.history.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)));
  const sortedEntries = Array.from(bySource.entries())
    .sort((a, b) => new Date(b[1].history[0]?.timestamp || 0) - new Date(a[1].history[0]?.timestamp || 0))
    .slice(0, EVENT_LOG.MAX_ENTRIES);

  // Build flat list for session history state (most recent first)
  const historyEntries = [];
  sortedEntries.forEach(([, e]) => {
    e.history.forEach(h => historyEntries.push({
      source: e.displaySource,
      target: h.target,
      method: h.method,
      confidence: h.confidence,
      timestamp: h.timestamp,
      web_search_status: h.web_search_status
    }));
  });
  historyEntries.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  setSessionHistory(historyEntries);

  // Render rows
  sortedEntries.forEach(([k, e]) => {
      const latest = e.history[0];
      const row = renderRow(null, { source: e.displaySource, sessionKey: null, timestamp: latest.timestamp }, latest, e.history.length);
      row.classList.add("cached-entry");
      sourceIndex.set(k, { row, history: e.history });
      addClickHandler(row, latest.target, e.displaySource);
      tableBody.appendChild(row);
    });
  // Tab counter updated reactively via setSessionHistory -> SESSION_HISTORY_CHANGED
}
