import { getStateValue } from "../core/state-actions.js";

export function updateMatcherIndicator() {
  const indicator = document.getElementById("matcher-status-indicator");
  if (!indicator) return;

  const mappings = getStateValue('mappings.combined');
  const serverOnline = getStateValue('server.online');

  const forwardCount = Object.keys(mappings?.forward || {}).length;
  const reverseCount = Object.keys(mappings?.reverse || {}).length;
  const totalTerms = reverseCount; // Reverse is authoritative for unique terms

  const countsSpan = indicator.querySelector(".indicator-counts");
  if (countsSpan) {
    countsSpan.textContent = `${forwardCount}/${reverseCount}`;
  }

  let status, statusText, title;

  if (!getStateValue('mappings.loaded') || totalTerms === 0) {
    status = "not-ready";
    statusText = "Not loaded";
    title = "Mappings: Not loaded\nClick to see details";
  } else if (serverOnline) {
    status = "ready";
    statusText = "Ready";
    title = `Mappings: Ready\n${forwardCount} forward, ${reverseCount} reverse\nFull functionality (exact/fuzzy/LLM)`;
  } else {
    status = "limited";
    statusText = "Limited";
    title = `Mappings: Limited Mode\n${forwardCount} forward, ${reverseCount} reverse\nExact/fuzzy only (LLM unavailable)`;
  }

  const labelSpan = indicator.querySelector(".indicator-label");
  if (labelSpan) {
    labelSpan.textContent = statusText;
  }

  indicator.className = `badge badge-bordered badge-interactive matcher-indicator ${status}`;
  indicator.title = title;
  indicator.setAttribute("data-status", status);
}

export function setupMatcherIndicator() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#matcher-status-indicator")) {
      e.preventDefault();
      showMatcherDetails();
    }
  });
}

function showMatcherDetails() {
  const mappings = getStateValue('mappings.combined');
  const serverInfo = getStateValue('server.info') || {};
  const forwardCount = Object.keys(mappings?.forward || {}).length;
  const reverseCount = Object.keys(mappings?.reverse || {}).length;

  let details = `📊 MAPPINGS STATUS\n\n`;
  details += `Forward: ${forwardCount} | Reverse: ${reverseCount}\n`;
  details += `Status: ${getStateValue('mappings.loaded') ? "Loaded" : "Not loaded"}\n\n`;
  details += `Backend: ${getStateValue('server.online') ? "Online" : "Offline"}\n`;
  details += `Host: ${getStateValue('server.host') || "Not configured"}\n`;

  if (getStateValue('server.online') && serverInfo.provider) {
    details += `LLM: ${serverInfo.provider}\n`;
  }

  details += `\nCapabilities:\n`;
  if (!getStateValue('mappings.loaded')) {
    details += `❌ Load mappings first\n`;
  } else if (getStateValue('server.online')) {
    details += `✅ Exact/Fuzzy/LLM\n`;
  } else {
    details += `✅ Exact/Fuzzy\n⚠️ LLM unavailable\n`;
  }

  alert(details);
}
