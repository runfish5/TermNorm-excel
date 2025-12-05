/** Build activity table row from normalized result data */
export function buildActivityRow({ source, sessionKey, timestamp }, { target, method, confidence, web_search_status }) {
  const displayTime = new Date(timestamp || Date.now()).toLocaleTimeString();
  const methodText = web_search_status === "failed" && method === "ProfileRank"
    ? `⚠️ ${method.toUpperCase()} (web scrape ∅)`
    : (method?.toUpperCase() || "-");

  const row = document.createElement("tr");
  row.className = `history-row ${method}`;
  row.dataset.sessionKey = sessionKey || "";
  row.dataset.identifier = target || "";
  row.innerHTML = `
    <td class="time">${displayTime}</td>
    <td class="source">${source || "-"}</td>
    <td class="target">${target || "-"}</td>
    <td class="method">${methodText}</td>
    <td class="confidence">${method !== "error" && confidence ? Math.round(confidence * 100) + "%" : "-"}</td>`;
  return row;
}
