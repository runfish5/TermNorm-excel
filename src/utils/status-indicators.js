/** Status Indicators - LED, matcher status, and warning displays */
import { getStateValue } from "../core/state-actions.js";
import { showMessage } from "./error-display.js";

export function updateLED() {
  const led = document.getElementById("server-status-led"), text = document.getElementById("server-status-text");
  if (!led) return;
  const online = getStateValue('server.online');
  led.className = online ? "led led-success" : "led led-error";
  led.title = "Click to refresh";
  if (text) text.textContent = online ? "Online" : "Offline";
}

export function updateMatcherIndicator() {
  const el = document.getElementById("matcher-status-indicator");
  if (!el) return;

  const mappings = getStateValue('mappings.combined'), online = getStateValue('server.online'), loaded = getStateValue('mappings.loaded');
  const fwd = Object.keys(mappings?.forward || {}).length, rev = Object.keys(mappings?.reverse || {}).length;

  el.querySelector(".indicator-counts")?.textContent && (el.querySelector(".indicator-counts").textContent = `${fwd}/${rev}`);

  const [status, text, title] = !loaded || !rev
    ? ["not-ready", "Not loaded", "Mappings: Not loaded\nClick to see details"]
    : online
      ? ["ready", "Ready", `Mappings: Ready\n${fwd} forward, ${rev} reverse\nFull functionality (exact/fuzzy/LLM)`]
      : ["limited", "Limited", `Mappings: Limited Mode\n${fwd} forward, ${rev} reverse\nExact/fuzzy only (LLM unavailable)`];

  el.querySelector(".indicator-label")?.textContent && (el.querySelector(".indicator-label").textContent = text);
  el.className = `badge badge-bordered badge-interactive matcher-indicator ${status}`;
  el.title = title;
  el.setAttribute("data-status", status);
}

export function updateWarnings() {
  const offline = document.getElementById("offline-mode-warning");
  if (offline) offline.classList.toggle("hidden", getStateValue('settings.requireServerOnline') !== false);

  const web = document.getElementById("web-search-warning");
  if (web) {
    const failed = getStateValue('webSearch.status') === "failed";
    web.classList.toggle("hidden", !failed);
    if (failed) web.title = `Web scraping failed: ${getStateValue('webSearch.error') || "Unknown error"}`;
  }
}

export function updateAllIndicators() { updateLED(); updateMatcherIndicator(); updateWarnings(); }

export function setupIndicators() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#server-status-led")) {
      e.preventDefault();
      import("./server-utilities.js").then((m) => m.checkServerStatus());
    }
    if (e.target.closest("#matcher-status-indicator")) {
      e.preventDefault();
      showMatcherDetails();
    }
  });
}

function showMatcherDetails() {
  const mappings = getStateValue('mappings.combined'), online = getStateValue('server.online'), loaded = getStateValue('mappings.loaded');
  const fwd = Object.keys(mappings?.forward || {}).length, rev = Object.keys(mappings?.reverse || {}).length;
  const provider = getStateValue('server.info')?.provider;

  showMessage(`📊 MAPPINGS STATUS\n\nForward: ${fwd} | Reverse: ${rev}\nStatus: ${loaded ? "Loaded" : "Not loaded"}\n\nBackend: ${online ? "Online" : "Offline"}\nHost: ${getStateValue('server.host') || "Not configured"}${online && provider ? `\nLLM: ${provider}` : ""}\n\nCapabilities:\n${!loaded ? "❌ Load mappings first" : online ? "✅ Exact/Fuzzy/LLM" : "✅ Exact/Fuzzy\n⚠️ LLM unavailable"}`);
}
