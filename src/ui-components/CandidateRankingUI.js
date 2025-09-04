// ./ui-components/CandidateRankingUI.js
import { ActivityFeed } from "./ActivityFeedUI.js";

export class ActivityDisplay {
  static container = null;
  static candidatesData = [];
  static currentContext = null;

  static init() {
    this.container = document.getElementById("results-view");
    if (!this.container) {
      return false;
    }

    // Set up toggle event listener
    this.container.addEventListener("change", (e) => {
      if (e.target.name === "activity-mode") {
        const isHistory = e.target.value === "history";
        const activityFeed = this.container.querySelector("#activity-feed");
        const candidateSection = this.container.querySelector("#candidate-ranking-section");

        if (activityFeed) {
          activityFeed.style.display = isHistory ? "block" : "none";
        }
        if (candidateSection) {
          candidateSection.style.display = isHistory ? "none" : "block";
        }
      }
    });

    ActivityFeed.init("activity-feed");
    return true;
  }

  static addCandidate(value, result, context) {
    const candidates = result?.candidates;
    if (!candidates || !this.container) return;

    this.candidatesData = [...candidates];
    this.currentContext = context;

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

    const rankedContainer = this.container.querySelector("#candidate-ranking-section");
    if (!rankedContainer) {
      return;
    }

    rankedContainer.innerHTML = `
          <div class="candidate-entry">
              <div class="candidate-header">Input: "${value}"</div>
              <div style="display: flex; align-items: center; margin-bottom: 10px; gap: 10px;">
                  <button id="apply-first" class="ms-Button ms-Button--primary ms-font-s">Apply First Choice</button>
              </div>
              <table class="candidate-table">
                  <thead><tr>${columns
                    .map((col) => `<th>${columnNames[col] || col.replace(/_/g, " ")}</th>`)
                    .join("")}</tr></thead>
                  <tbody>
                      ${this.candidatesData
                        .map(
                          (c, i) => `
                          <tr data-index="${i}">
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

    this.setupFirstChoice(rankedContainer);
  }

  static setupFirstChoice(container) {
    const applyButton = container.querySelector("#apply-first");
    if (!applyButton) {
      return;
    }

    applyButton.onclick = async () => {
      const first = this.candidatesData[0];
      if (!first || !this.currentContext) return;

      const feedback = this.showFeedback(container, "Processing...", "#f3f2f1");

      try {
        await this.currentContext.applyChoice(first);
        feedback.innerHTML = `✅ Applied: ${first.candidate} | Score: ${
          first.core_concept_score || first.spec_score || first.relevance_score || "N/A"
        }`;
        feedback.style.background = "#d4edda";
        setTimeout(() => feedback.remove(), 3000);
      } catch (error) {
        feedback.innerHTML = "❌ Error: Failed to apply first choice";
        feedback.style.background = "#f8d7da";
        setTimeout(() => feedback.remove(), 3000);
      }
    };
  }

  static showFeedback(container, message, bg) {
    let feedback = container.querySelector(".feedback");
    if (!feedback) {
      feedback = document.createElement("div");
      feedback.className = "feedback";
      feedback.style.cssText = `padding:8px;margin:8px 0;border-radius:4px;background:${bg};`;
      const table = container.querySelector("table");
      if (table) {
        table.before(feedback);
      } else {
        container.appendChild(feedback);
      }
    }
    feedback.innerHTML = message;
    return feedback;
  }


  static clearCandidates() {
    this.candidatesData = [];
    this.currentContext = null;
    const candidateSection = this.container.querySelector("#candidate-ranking-section");
    if (candidateSection) {
      candidateSection.innerHTML = '<div class="placeholder-text">Rankings appear here during processing</div>';
    }
  }

  static add = this.addCandidate;
  static clear = this.clearCandidates;
}

export const CandidateRankingUI = ActivityDisplay;
