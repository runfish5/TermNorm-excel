/**
 * Pure function to build activity table row from normalized result data
 * No DOM side effects, no data fetching - just HTML creation
 */

/**
 * Build activity row HTML from normalized result data
 *
 * @param {Object} activity - Activity metadata
 * @param {string} activity.source - Original input value
 * @param {string} activity.sessionKey - Cell key (row:col format) or null for cached entries
 * @param {string} activity.timestamp - ISO timestamp
 * @param {Object} result - Normalized result data
 * @param {string} result.target - Target identifier
 * @param {string} result.method - Match method (cached/fuzzy/ProfileRank/etc)
 * @param {number} result.confidence - Match confidence (0.0-1.0)
 * @param {string} result.web_search_status - Web search status (for LLM only)
 * @returns {HTMLTableRowElement} Constructed table row
 */
export function buildActivityRow(activity, result) {
  const { source, sessionKey, timestamp } = activity;
  const { target, method, confidence, web_search_status } = result;

  const displayTime = timestamp ? new Date(timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();

  // Build method display text with web search status indicator
  let methodText = method ? method.toUpperCase() : "-";
  if (web_search_status === "failed" && method === "ProfileRank") {
    methodText = `⚠️ ${methodText} (web scrape ∅)`;
  }

  const row = document.createElement("tr");
  row.className = `history-row ${method}`;
  row.dataset.sessionKey = sessionKey || "";
  row.dataset.identifier = target || "";
  row.innerHTML = `
    <td class="time">${displayTime}</td>
    <td class="source">${source || "-"}</td>
    <td class="target">${target || "-"}</td>
    <td class="method">${methodText}</td>
    <td class="confidence">${method !== "error" && confidence ? Math.round(confidence * 100) + "%" : "-"}</td>
  `;

  return row;
}
