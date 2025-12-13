import { init as initHistory } from "./processing-history.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { UI_TIMINGS } from "../config/config.js";

let container = null, candidatesData = [], currentContext = null;

eventBus.on(Events.CANDIDATES_AVAILABLE, ({ source, result, applyChoice }) => addCandidate(source, result, { applyChoice }));

export function init() {
  container = document.getElementById("results-view");
  if (!container) return false;
  initHistory("processing-history-feed");
  return true;
}

export function addCandidate(value, result, context) {
  if (!result?.candidates || (!container && !init())) return;
  candidatesData = [...result.candidates];
  currentContext = context;

  const names = { core_concept_score: "Core", spec_score: "Spec", key_match_factors: "Factors", spec_gaps: "Gaps" };
  const cols = [...new Set(candidatesData.flatMap(c => Object.keys(c).filter(k => !k.startsWith("_") && k !== "abc")))];
  const section = container.querySelector("#candidate-ranking-section");
  if (!section) return;

  section.innerHTML = `
    <div class="candidate-entry">
      <div class="candidate-header">Input: "${value}"</div>
      <div class="candidate-inline-header">
        <button id="apply-first" class="btn-primary">Apply First</button>
        <span class="candidate-drag-hint">Drag to reorder</span>
      </div>
      <table class="candidate-table">
        <thead>
          <tr>
            <th>🔀</th>
            ${cols.map(c => `<th>${names[c] || c.replace(/_/g, " ")}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${candidatesData.map((c, i) => `
            <tr draggable="true" data-index="${i}">
              <td class="drag-handle">⋮⋮</td>
              ${cols.map(col => `<td>${Array.isArray(c[col]) ? c[col].join(", ") : c[col] || ""}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>`;

  setupDragDrop(section);
  const btn = section.querySelector("#apply-first");
  if (btn) btn.onclick = async () => {
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
