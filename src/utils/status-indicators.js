/** Status Indicators - LED, matcher status, and warning displays */
import { getStateValue } from "../core/state-actions.js";
import { showMessage } from "./error-display.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { $ } from "./dom-helpers.js";
const getMappingCounts = () => { const m = getStateValue('mappings.combined'); return { fwd: Object.keys(m?.forward || {}).length, rev: Object.keys(m?.reverse || {}).length }; };

export function updateLED() {
  const led = $("server-status-led"), text = $("server-status-text"), online = getStateValue('server.online');
  if (!led) return;
  led.className = online ? "led led-success" : "led led-error";
  led.title = "Click to refresh";
  if (text) text.textContent = online ? "Online" : "Offline";
}

export function updateMatcherIndicator() {
  const el = $("matcher-status-indicator");
  if (!el) return;

  const { fwd, rev } = getMappingCounts(), online = getStateValue('server.online'), loaded = getStateValue('mappings.loaded');
  const counts = el.querySelector(".indicator-counts"), label = el.querySelector(".indicator-label");
  if (counts) counts.textContent = `${fwd}/${rev}`;

  const [status, text, title] = !loaded || !rev
    ? ["not-ready", "Not loaded", "Mappings: Not loaded\nClick to see details"]
    : online
      ? ["ready", "Ready", `Mappings: Ready\n${fwd} forward, ${rev} reverse\nFull functionality (exact/fuzzy/LLM)`]
      : ["limited", "Limited", `Mappings: Limited Mode\n${fwd} forward, ${rev} reverse\nExact/fuzzy only (LLM unavailable)`];

  if (label) label.textContent = text;
  el.className = `badge badge-bordered badge-interactive matcher-indicator ${status}`;
  el.title = title;
}

export function updateWarnings() {
  const offline = $("offline-mode-warning");
  if (offline) offline.classList.toggle("hidden", getStateValue('settings.requireServerOnline') !== false);

  const web = $("web-search-warning"), failed = getStateValue('webSearch.status') === "failed";
  if (web) { web.classList.toggle("hidden", !failed); if (failed) web.title = `Web scraping failed: ${getStateValue('webSearch.error') || "Unknown error"}`; }
}

export function updateAllIndicators() { updateLED(); updateMatcherIndicator(); updateWarnings(); }

export function setupIndicators() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#server-status-led")) { e.preventDefault(); import("./server-utilities.js").then(m => m.checkServerStatus()); }
    if (e.target.closest("#matcher-status-indicator")) { e.preventDefault(); showMatcherDetails(); }
  });
  eventBus.on(Events.WEB_SEARCH_STATUS_CHANGED, updateWarnings);
}

function showMatcherDetails() {
  const { fwd, rev } = getMappingCounts(), online = getStateValue('server.online'), loaded = getStateValue('mappings.loaded'), provider = getStateValue('server.info')?.provider;
  showMessage(`📊 MAPPINGS STATUS\n\nForward: ${fwd} | Reverse: ${rev}\nStatus: ${loaded ? "Loaded" : "Not loaded"}\n\nBackend: ${online ? "Online" : "Offline"}\nHost: ${getStateValue('server.host') || "Not configured"}${online && provider ? `\nLLM: ${provider}` : ""}\n\nCapabilities:\n${!loaded ? "❌ Load mappings first" : online ? "✅ Exact/Fuzzy/LLM" : "✅ Exact/Fuzzy\n⚠️ LLM unavailable"}`);
}
