import { init as initHistory } from "./processing-history.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { UI_TIMINGS } from "../config/config.js";
import { $, setupColumnResize } from "../utils/dom-helpers.js";

let container = null, candidatesData = [], currentContext = null;

eventBus.on(Events.CANDIDATES_AVAILABLE, ({ source, result, applyChoice }) => addCandidate(source, result, { applyChoice }));
eventBus.on(Events.BATCH_RESULTS, ({ items, userPrompt }) => renderBatchResults(items, userPrompt));

export function init() {
  container = $("results-view");
  if (!container) return false;
  initHistory("processing-history-feed");
  return true;
}

export function addCandidate(value, result, context) {
  if (!result?.candidates || (!container && !init())) return;
  candidatesData = [...result.candidates];
  currentContext = context;

  const names = { key_match_factors: "Factors", spec_gaps: "Gaps", _scores: "Scores" };
  const hidden = ["abc", "relevance_score", "core_concept_score", "spec_score"];
  const cols = ["_scores", ...new Set(candidatesData.flatMap(c => Object.keys(c).filter(k => !k.startsWith("_") && !hidden.includes(k))))];
  const fmt = (v) => v != null ? v.toFixed(2) : "-";
  const cell = (c, col) => col === "_scores"
    ? `a:${fmt(c.relevance_score)} b:${fmt(c.core_concept_score)} c:${fmt(c.spec_score)}`
    : Array.isArray(c[col]) ? c[col].join(", ") : c[col] || "";
  const section = container.querySelector("#candidate-ranking-section");
  if (!section) return;

  // Show the Apply First button in the header
  const applyBtn = $("apply-first");
  if (applyBtn) applyBtn.classList.remove("hidden");

  section.innerHTML = `
    <div class="candidate-entry">
      <div class="candidate-header">Input: "${value}"</div>
      <div class="candidate-inline-header">
        <span class="candidate-drag-hint">Drag to reorder</span>
      </div>
      <table class="candidate-table table-resizable">
        <thead>
          <tr>
            <th>🔀</th>
            ${cols.map(c => `<th>${names[c] || c.replace(/_/g, " ")}<span class="resize-handle"></span></th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${candidatesData.map((c, i) => `
            <tr draggable="true" data-index="${i}">
              <td class="drag-handle">⋮⋮</td>
              ${cols.map(col => `<td>${cell(c, col)}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;

  setupDragDrop(section);
  setupColumnResize(section.querySelector("table"));

  // Wire up Apply First button in header
  const headerBtn = $("apply-first");
  if (headerBtn) headerBtn.onclick = async () => {
    const first = candidatesData[0];
    if (!first || !currentContext) return;
    const fb = showFeedback(section, "Processing...", "bg-muted");
    try { await currentContext.applyChoice(first); fb.innerHTML = `✅ ${first.candidate}`; fb.classList.replace("bg-muted", "bg-success"); }
    catch { fb.innerHTML = "❌ Failed"; fb.classList.replace("bg-muted", "bg-error"); }
    setTimeout(() => fb.remove(), UI_TIMINGS.FEEDBACK_REMOVE_MS);
  };
}

function showFeedback(el, msg, bg = "bg-muted") {
  let fb = el.querySelector(".feedback");
  if (!fb) { fb = document.createElement("div"); fb.className = "feedback p-md mb-md rounded-lg"; const t = el.querySelector("table"); t ? t.before(fb) : el.appendChild(fb); }
  fb.classList.remove("bg-muted", "bg-success", "bg-error");
  fb.classList.add(bg);
  fb.innerHTML = msg;
  return fb;
}

function setupDragDrop(el) {
  const tbody = el.querySelector("tbody");
  if (!tbody) return;
  let dragIdx = null;

  tbody.ondragstart = (e) => { if (e.target.tagName === "TR") { dragIdx = +e.target.dataset.index; e.target.classList.add("dragging"); } };
  tbody.ondragend = (e) => { if (e.target.tagName === "TR") { e.target.classList.remove("dragging"); tbody.querySelectorAll("tr").forEach(r => r.classList.remove("drag-over")); } };
  tbody.ondragover = (e) => { e.preventDefault(); const tr = e.target.closest("tr"); if (tr && dragIdx !== null) { tbody.querySelectorAll("tr").forEach(r => r.classList.remove("drag-over")); tr.classList.add("drag-over"); } };
  tbody.ondrop = (e) => {
    e.preventDefault();
    const tr = e.target.closest("tr");
    if (tr && dragIdx !== null) {
      const [item] = candidatesData.splice(dragIdx, 1);
      candidatesData.splice(+tr.dataset.index, 0, item);
      addCandidate(el.querySelector(".candidate-header").textContent.match(/Input: "([^"]+)"/)?.[1], { candidates: candidatesData }, currentContext);
    }
    dragIdx = null;
  };
}

function renderBatchResults(items, userPrompt) {
  if (!items?.length || (!container && !init())) return;
  const section = container.querySelector("#candidate-ranking-section");
  if (!section) return;

  const truncatedPrompt = userPrompt?.length > 50 ? userPrompt.slice(0, 50) + "..." : userPrompt || "";
  const cardsHTML = items.map((item, i) => {
    const conf = Math.round((item.confidence || 0) * 100);
    const confClass = conf >= 90 ? "confidence-high" : conf >= 70 ? "confidence-medium" : "confidence-low";
    return `
      <details class="batch-result-card" ${i === 0 ? "open" : ""}>
        <summary class="batch-result-summary">
          <span class="batch-result-source">${item.source || "-"}</span>
          <span class="batch-result-arrow">→</span>
          <span class="batch-result-target">${item.target || "-"}</span>
          <span class="batch-result-confidence ${confClass}">${conf}%</span>
        </summary>
        <div class="batch-result-content">
          <div><strong>Source:</strong> ${item.source || "-"}</div>
          <div><strong>Target:</strong> ${item.target || "-"}</div>
          <div><strong>Confidence:</strong> ${conf}%</div>
        </div>
      </details>`;
  }).join("");

  section.innerHTML = `
    <div class="batch-results-container">
      <div class="batch-results-header">
        <span class="batch-results-title">Direct Prompt Results (${items.length})</span>
        <div class="batch-results-actions">
          <button class="btn-sm btn-secondary" id="batch-expand-all">Expand All</button>
          <button class="btn-sm btn-secondary" id="batch-collapse-all">Collapse All</button>
        </div>
      </div>
      <div class="batch-results-prompt" title="${userPrompt || ''}">${truncatedPrompt}</div>
      <div class="batch-results-cards">${cardsHTML}</div>
    </div>`;

  section.querySelector("#batch-expand-all")?.addEventListener("click", () => {
    section.querySelectorAll(".batch-result-card").forEach(d => d.open = true);
  });
  section.querySelector("#batch-collapse-all")?.addEventListener("click", () => {
    section.querySelectorAll(".batch-result-card").forEach(d => d.open = false);
  });
}
