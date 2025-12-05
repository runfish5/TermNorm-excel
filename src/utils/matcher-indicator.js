import { getStateValue } from "../core/state-actions.js";
import { showMessage } from "./error-display.js";

export function updateMatcherIndicator() {
  const indicator = document.getElementById("matcher-status-indicator");
  if (!indicator) return;

  const mappings = getStateValue('mappings.combined'), online = getStateValue('server.online'), loaded = getStateValue('mappings.loaded');
  const fwd = Object.keys(mappings?.forward || {}).length, rev = Object.keys(mappings?.reverse || {}).length;

  indicator.querySelector(".indicator-counts")?.textContent && (indicator.querySelector(".indicator-counts").textContent = `${fwd}/${rev}`);

  const [status, text, title] = !loaded || !rev
    ? ["not-ready", "Not loaded", "Mappings: Not loaded\nClick to see details"]
    : online
      ? ["ready", "Ready", `Mappings: Ready\n${fwd} forward, ${rev} reverse\nFull functionality (exact/fuzzy/LLM)`]
      : ["limited", "Limited", `Mappings: Limited Mode\n${fwd} forward, ${rev} reverse\nExact/fuzzy only (LLM unavailable)`];

  indicator.querySelector(".indicator-label")?.textContent && (indicator.querySelector(".indicator-label").textContent = text);
  indicator.className = `badge badge-bordered badge-interactive matcher-indicator ${status}`;
  indicator.title = title;
  indicator.setAttribute("data-status", status);
}

export function setupMatcherIndicator() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#matcher-status-indicator")) { e.preventDefault(); showMatcherDetails(); }
  });
}

function showMatcherDetails() {
  const mappings = getStateValue('mappings.combined'), online = getStateValue('server.online'), loaded = getStateValue('mappings.loaded');
  const fwd = Object.keys(mappings?.forward || {}).length, rev = Object.keys(mappings?.reverse || {}).length;
  const provider = getStateValue('server.info')?.provider;

  showMessage(`📊 MAPPINGS STATUS\n\nForward: ${fwd} | Reverse: ${rev}\nStatus: ${loaded ? "Loaded" : "Not loaded"}\n\nBackend: ${online ? "Online" : "Offline"}\nHost: ${getStateValue('server.host') || "Not configured"}${online && provider ? `\nLLM: ${provider}` : ""}\n\nCapabilities:\n${!loaded ? "❌ Load mappings first" : online ? "✅ Exact/Fuzzy/LLM" : "✅ Exact/Fuzzy\n⚠️ LLM unavailable"}`);
}
