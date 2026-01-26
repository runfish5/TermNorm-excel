// UI Feedback - Status messages and indicator displays
import { UI_TIMINGS } from "../config/config.js";
import { getStateValue } from "../core/state-actions.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { $ } from "./dom-helpers.js";

// Shorten known Office.js errors with actionable guidance
export function formatError(message) {
  if (message?.includes("requested file could not be read") || message?.includes("permission problems")) {
    return "File was modified and saved elsewhere. Close it in the other Excel window to load the latest version here.";
  }
  return message;
}

// Status message display
let statusEl = null, dotsInterval = null;
const clearDots = () => { if (dotsInterval) { clearInterval(dotsInterval); dotsInterval = null; } };
const bubbleSide = (side) => `<div class="bubble-loader ${side}"><div class="bubble ${side}"></div><div class="pop-flash ${side}"></div>${[1,2,3,4].map(n => `<div class="quarter quarter-${n} ${side}"></div>`).join('')}</div>`;

export function showMessage(text, type = "info") {
  const el = statusEl || (statusEl = $("main-status-message"));
  if (!el) return;
  clearDots();

  if (type === "processing" || type === "waiting" || text.toLowerCase().includes("processing")) {
    const content = type === "waiting" ? '<span class="hourglass-emoji">⏳</span>' : `<div class="bubble-container">${bubbleSide('left')}${bubbleSide('right')}</div>`;
    el.innerHTML = `<div class="loading-container">${content}<span class="loading-message">${text}</span><span class="loading-dots"></span></div>`;
    el.classList.remove("status-message--error");
    const dotsEl = el.querySelector('.loading-dots'), states = ['', '.', '..', '...', '..', '.'];
    let i = 0;
    dotsInterval = setInterval(() => { if (dotsEl) dotsEl.textContent = states[i = (i + 1) % 6]; }, UI_TIMINGS.LOADING_DOTS_MS);
  } else {
    el.textContent = text;
    el.classList.toggle("status-message--error", type === "error");
  }
}

// LED and indicator displays
const getCacheCounts = () => {
  const entries = getStateValue('history.entries') || {};
  const entities = Object.keys(entries).length;
  const aliases = Object.values(entries).reduce((sum, e) => sum + Object.keys(e.aliases || {}).length, 0);
  return { entities, aliases };
};

export function updateLED() {
  const led = $("server-status-led"), text = $("server-status-text"), online = getStateValue('server.online');
  if (!led) return;
  led.className = online ? "led led-success" : "led led-error";
  led.title = online ? "Click to refresh" : "Server offline - click for setup instructions";
  if (text) text.textContent = online ? "Online" : "Offline";
}

export function updateMatcherIndicator() {
  const el = $("matcher-status-indicator");
  if (!el) return;

  const { entities, aliases } = getCacheCounts(), online = getStateValue('server.online'), loaded = getStateValue('mappings.loaded');
  const trackingActive = getStateValue('tracking.active');
  const counts = el.querySelector(".indicator-counts"), label = el.querySelector(".indicator-label");
  if (counts) counts.textContent = `${aliases} → ${entities}`;

  const [status, text, title] = !loaded
    ? ["not-ready", "Not loaded", "Mappings: Not loaded\nClick to see details"]
    : !trackingActive
      ? ["paused", "Paused", `Cache: ${entities} entities, ${aliases} aliases\nTracking is paused`]
      : online
        ? ["ready", "Ready", `Cache: ${entities} entities, ${aliases} aliases\nFull functionality (exact/fuzzy/LLM)`]
        : ["limited", "Limited", `Cache: ${entities} entities, ${aliases} aliases\nExact/fuzzy only (LLM unavailable)`];

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
    if (e.target.closest("#server-status-led")) {
      e.preventDefault();
      if (getStateValue('server.online')) return import("./api-fetch.js").then(m => m.checkServerStatus());
      // Offline: navigate to Setup Step 1 and reset wizard
      import("./dom-helpers.js").then(({ showView }) => showView("setup"));
      import("../taskpane/taskpane.js").then(({ wizardState }) => { wizardState.reset(); wizardState.goTo(1); });
      showMessage("Start the Python server using the instructions below");
    }
    if (e.target.closest("#matcher-status-indicator")) { e.preventDefault(); showMatcherDetails(); }
  });
  eventBus.on(Events.WEB_SEARCH_STATUS_CHANGED, updateWarnings);
  eventBus.on(Events.MATCH_LOGGED, updateMatcherIndicator);
  eventBus.on(Events.TRACKING_CHANGED, updateMatcherIndicator);
}

function showMatcherDetails() {
  const { entities, aliases } = getCacheCounts(), online = getStateValue('server.online'), loaded = getStateValue('mappings.loaded'), provider = getStateValue('server.info')?.provider;
  showMessage(`📊 CACHE STATUS\n\nEntities: ${entities} | Aliases: ${aliases}\nMappings: ${loaded ? "Loaded" : "Not loaded"}\n\nBackend: ${online ? "Online" : "Offline"}\nHost: ${getStateValue('server.host') || "Not configured"}${online && provider ? `\nLLM: ${provider}` : ""}\n\nCapabilities:\n${!loaded ? "❌ Load mappings first" : online ? "✅ Exact/Fuzzy/LLM" : "✅ Exact/Fuzzy\n⚠️ LLM unavailable"}`);
}
