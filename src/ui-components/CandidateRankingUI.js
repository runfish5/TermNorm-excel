import { init as initProcessingHistory } from "./ProcessingHistoryUI.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

let container = null;
let candidatesData = [];
let currentContext = null;

// CHECKPOINT 6: Listen to candidates available event
eventBus.on(Events.CANDIDATES_AVAILABLE, ({ source, result, applyChoice }) => {
  addCandidate(source, result, { applyChoice });
});

export function init() {
  container = document.getElementById("results-view");
  if (!container) {
    console.error("CandidateRankingUI: Could not find results-view container in DOM");
    return false;
  }

  const style = document.createElement("style");
  style.textContent = `
      .candidate-table tr { cursor: move; transition: background 0.2s; }
      .candidate-table tr:hover { background: #f3f2f1; }
      .candidate-table tr.dragging { opacity: 0.5; }
      .candidate-table tr.drag-over { border-top: 2px solid #0078d4; }
      .drag-handle { cursor: grab; padding: 4px; color: #605e5c; }
      .drag-handle:hover { color: #0078d4; }
      .drag-handle:active { cursor: grabbing; }
  `;
  document.head.appendChild(style);

  initProcessingHistory("processing-history-feed");
  return true;
}

export function addCandidate(value, result, context) {
  const candidates = result?.candidates;
  if (!candidates) return;

  if (!container) {
    const initSuccess = init();
    if (!initSuccess || !container) {
      console.error("CandidateRankingUI: Failed to initialize container, cannot display candidates");
      return;
    }
  }

  candidatesData = [...candidates];
  currentContext = context;

  // Column customization
  const hiddenColumns = ["abc"]; // Add columns to hide here
  const columnNames = {
    core_concept_score: "Core Score",
    spec_score: "Sp. Score",
    key_match_factors: "Match Factors",
    spec_gaps: "Gaps",
  };

  // Get all unique keys from candidates, excluding private properties and hidden ones
  const columns = [
    ...new Set(
      candidates.flatMap((c) => Object.keys(c).filter((k) => !k.startsWith("_") && !hiddenColumns.includes(k)))
    ),
  ];

  const rankedContainer = container.querySelector("#candidate-ranking-section");
  if (!rankedContainer) {
    console.error("CandidateRankingUI: Could not find candidate-ranking-section within results-view");
    return;
  }

  rankedContainer.innerHTML = `
        <div class="candidate-entry">
            <div class="candidate-header">Input: "${value}"</div>
            <div class="candidate-inline-header">
                <button id="apply-first" class="ms-Button ms-Button--primary ms-font-s">Apply First Choice</button>
                <span class="candidate-drag-hint">Drag rows to reorder</span>
            </div>
            <table class="candidate-table">
                <thead><tr><th>🔀</th>${columns
                  .map((col) => `<th>${columnNames[col] || col.replace(/_/g, " ")}</th>`)
                  .join("")}</tr></thead>
                <tbody>
                    ${candidatesData
                      .map(
                        (c, i) => `
                        <tr draggable="true" data-index="${i}">
                            <td class="drag-handle">⋮⋮</td>
                            ${columns
                              .map((col) => `<td>${Array.isArray(c[col]) ? c[col].join(", ") : c[col] || ""}</td>`)
                              .join("")}
                        </tr>
                    `
                      )
                      .join("")}
                </tbody>
            </table>
        </div>
    `;

  setupDragDrop(rankedContainer);
  setupFirstChoice(rankedContainer);
}

function setupFirstChoice(containerElement) {
  const applyButton = containerElement.querySelector("#apply-first");
  if (!applyButton) {
    return;
  }

  applyButton.onclick = async () => {
    const first = candidatesData[0];
    if (!first || !currentContext) return;

    const feedback = showFeedback(containerElement, "Processing...", "bg-muted");

    try {
      await currentContext.applyChoice(first);
      feedback.innerHTML = `✅ Applied: ${first.candidate} | Score: ${
        first.core_concept_score || first.spec_score || first.relevance_score || "N/A"
      }`;
      feedback.classList.remove("bg-muted");
      feedback.classList.add("bg-success");
      setTimeout(() => feedback.remove(), 3000);
    } catch (error) {
      feedback.innerHTML = "❌ Error: Failed to apply first choice";
      feedback.classList.remove("bg-muted");
      feedback.classList.add("bg-error");
      setTimeout(() => feedback.remove(), 3000);
    }
  };
}

function showFeedback(containerElement, message, bgClass = "bg-muted") {
  let feedback = containerElement.querySelector(".feedback");
  if (!feedback) {
    feedback = document.createElement("div");
    feedback.className = "feedback p-md mb-md rounded-lg";
    const table = containerElement.querySelector("table");
    if (table) {
      table.before(feedback);
    } else {
      containerElement.appendChild(feedback);
    }
  }
  // Update background class
  feedback.classList.remove("bg-muted", "bg-success", "bg-error");
  feedback.classList.add(bgClass);
  feedback.innerHTML = message;
  return feedback;
}

function setupDragDrop(containerElement) {
  const tbody = containerElement.querySelector("tbody");
  if (!tbody) {
    console.error("CandidateRankingUI: tbody not found in container");
    return;
  }

  let dragIndex = null;

  tbody.ondragstart = (e) => {
    if (e.target.tagName === "TR") {
      dragIndex = parseInt(e.target.dataset.index);
      e.target.classList.add("dragging");
    }
  };

  tbody.ondragend = (e) => {
    if (e.target.tagName === "TR") {
      e.target.classList.remove("dragging");
      tbody.querySelectorAll("tr").forEach((row) => row.classList.remove("drag-over"));
    }
  };

  tbody.ondragover = (e) => {
    e.preventDefault();
    const targetRow = e.target.closest("tr");
    if (targetRow && dragIndex !== null) {
      tbody.querySelectorAll("tr").forEach((row) => row.classList.remove("drag-over"));
      targetRow.classList.add("drag-over");
    }
  };

  tbody.ondrop = (e) => {
    e.preventDefault();
    const targetRow = e.target.closest("tr");
    if (targetRow && dragIndex !== null) {
      const targetIndex = parseInt(targetRow.dataset.index);
      const [draggedItem] = candidatesData.splice(dragIndex, 1);
      candidatesData.splice(targetIndex, 0, draggedItem);

      const headerElement = containerElement.querySelector(".candidate-header");
      const input = headerElement.textContent.match(/Input: "([^"]+)"/)?.[1];
      const mockResult = { candidates: candidatesData };
      addCandidate(input, mockResult, currentContext);
    }
    dragIndex = null;
  };
}
