import { startTracking } from "../services/live-tracker.js";
import { init as initHistory, updateHistoryTabCounter } from "../ui-components/processing-history.js";
import { init as initDirectPrompt } from "../ui-components/direct-prompt.js";
import { init as initCandidates } from "../ui-components/candidate-ranking.js";
import { init as initSettingsPanel } from "../ui-components/settings-panel.js";
import { Thermometer } from "../ui-components/thermometer.js";
import { setupServerEvents, checkServerStatus } from "../utils/server-utilities.js";
import { initializeHistoryCache } from "../utils/history-cache.js";
import { initializeSettings, saveSetting } from "../services/workflows.js";
import { getStateValue } from "../core/state-actions.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { initializeProjectPathDisplay } from "../utils/app-utilities.js";
import { $, showView, setupButton, openModal, closeModal } from "../utils/dom-helpers.js";
import { setupFileHandling, loadStaticConfig } from "../ui-components/file-handling.js";
import { showMessage } from "../utils/error-display.js";
import { updateAllIndicators, setupIndicators } from "../utils/status-indicators.js";
const refresh = () => { updateAllIndicators(); updateButtonStates(); };

let setupThermo = null;
let researchThermo = null;

function setupUIReactivity() {
  [Events.SERVER_STATUS_CHANGED, Events.MAPPINGS_LOADED, Events.SETTING_CHANGED].forEach(e => eventBus.on(e, refresh));
  eventBus.on(Events.CONFIG_LOADED, updateButtonStates);

  // Auto-progression: advance thermometer and show corresponding panel (only forward, never back)
  let currentStep = 1;
  const goToStep = (num) => {
    if (!setupThermo || num <= currentStep) return; // Only advance forward
    currentStep = num;
    setupThermo.setStep(num);
    document.querySelectorAll(".step-panel").forEach(p => p.classList.toggle("active", p.dataset.step === String(num)));
  };

  eventBus.on(Events.SERVER_STATUS_CHANGED, ({ online }) => { if (online) goToStep(2); });
  eventBus.on(Events.CONFIG_LOADED, () => goToStep(3));
  eventBus.on(Events.MAPPINGS_LOADED, () => {
    const loaded = Object.keys(getStateValue('mappings.sources') || {}).length;
    const total = getStateValue('config.data')?.standard_mappings?.length || 0;
    console.log(`[Thermo] Mappings: ${loaded}/${total}`);
    if (total > 0 && loaded >= total) goToStep(4);
  });

  refresh();
}

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) return $("sideload-msg").textContent = "This add-in requires Microsoft Excel";

  initHistory(); initDirectPrompt(); initCandidates(); updateHistoryTabCounter();
  $("sideload-msg")?.classList.add("hidden");
  const appBody = $("app-body");
  if (appBody) { appBody.classList.remove("hidden"); appBody.style.display = "flex"; }

  setupThermo = Thermometer.init('setup-thermo');
  initializeSettings(); setupFileHandling(); setupServerEvents(); setupIndicators();
  eventBus.on(Events.SERVER_RECONNECTED, () => initializeHistoryCache());
  eventBus.on(Events.TRACKING_STOPPED, () => {
    $("research-thermo")?.classList.add("hidden");
    if (setupThermo) { setupThermo.reset(); setupThermo.expand(); }
    showView("setup");
  });
  setupUIReactivity();
  checkServerStatus(); initializeProjectPathDisplay();
  initSettingsPanel();

  setupButton("offline-mode-warning", () => { showView("settings"); showMessage("Offline mode active - re-enable in Settings"); });

  $("show-metadata-btn")?.addEventListener("click", () => {
    const c = $("metadata-content");
    if (c) { c.classList.toggle("hidden"); $("show-metadata-btn").textContent = c.classList.contains("hidden") ? "Show Processing Details" : "Hide Processing Details"; }
  });

  // Modal delegation - handles all modals via data attributes
  setupButton("help-icon-btn", () => openModal("help-modal"));
  setupButton("close-help-modal", () => closeModal("help-modal"));
  $("help-modal")?.addEventListener("click", (e) => e.target.classList.contains("help-modal") && closeModal("help-modal"));

  $("setup-map-tracking")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Activating...";
    try { await startLiveTracking(); } catch (err) { showMessage(`Activation failed: ${err.message}`, "error"); }
    finally { e.target.disabled = false; e.target.textContent = "Activate Tracking"; }
  });

  document.addEventListener("click", async (e) => {
    const tab = e.target.closest(".nav-tab");
    if (tab) { e.preventDefault(); showView(tab.dataset.view); if (tab.dataset.view === "settings") eventBus.emit(Events.SETTINGS_PANEL_OPENED); }
    const step = e.target.closest(".thermo__step");
    // Only switch panels for setup thermometer, not research thermometer
    if (step && step.closest("#setup-thermo") && setupThermo) {
      e.preventDefault();
      const num = parseInt(step.dataset.step);
      if (num) {
        setupThermo.setStep(num);
        document.querySelectorAll(".step-panel").forEach(p => p.classList.toggle("active", p.dataset.step === String(num)));
      }
    }
  });

  try { await loadStaticConfig(); } catch (err) { console.error("Init failed:", err); showMessage(`Init failed: ${err.message}`, "error"); }
});

function canActivateTracking() {
  const config = getStateValue('config.loaded'), mappings = getStateValue('mappings.combined'), online = getStateValue('server.online');
  if (!config) return { reason: "Load config file first" };
  if (!getStateValue('mappings.loaded') || !mappings) return { reason: "Load mapping files first" };
  if (!Object.keys(mappings?.forward || {}).length && !Object.keys(mappings?.reverse || {}).length) return { reason: "No mapping data" };
  if (getStateValue('settings.requireServerOnline') && !online) return { reason: "Server required (change in Settings)" };
  return { ok: true, warning: !online ? "⚠️ Server offline - exact/fuzzy only" : null };
}

function updateButtonStates() {
  const btn = $("setup-map-tracking");
  if (!btn) return;
  const v = canActivateTracking();
  btn.disabled = !v.ok;
  btn.title = v.ok ? "Start live cell tracking" : v.reason;
  btn.classList.toggle("disabled-with-reason", !v.ok);
}

async function startLiveTracking() {
  await checkServerStatus();
  const v = canActivateTracking();
  if (!v.ok) return showMessage(`❌ ${v.reason}`, "error");
  if (v.warning) showMessage(v.warning);

  try {
    const config = getStateValue('config.data'), mappings = getStateValue('mappings.combined');
    const terms = Object.keys(mappings.reverse || {}).length, online = getStateValue('server.online');
    const info = await startTracking(config, mappings);

    let msg = `✅ Tracking: ${terms} terms (${online ? "exact/fuzzy/LLM" : "exact/fuzzy only"})`;
    if (info.confidenceTotal > 0) {
      const { confidenceTotal: t, confidenceMapped: m, confidenceFound: f, confidenceMissing: x } = info;
      msg += `\n${m === t ? "✅" : "⚠️"} Confidence: ${m}/${t} columns`;
      if (x.length) msg += `\n❌ Missing: ${x.join(", ")}`;
    }
    showMessage(msg);

    // Collapse setup thermometer, show research thermometer
    if (setupThermo) {
      setupThermo.completeAll();
      setupThermo.collapse();
    }
    $("research-thermo")?.classList.remove("hidden");

    // Initialize research thermometer with toggleable steps
    if (!researchThermo) {
      researchThermo = Thermometer.init('research-thermo');
      if (researchThermo) {
        // Web search toggle
        const webSearchOn = getStateValue('settings.useWebSearch') !== false;
        researchThermo.setToggleable('webS', webSearchOn);
        // LLM ranking toggle
        const llmRankingOn = getStateValue('settings.useLlmRanking') !== false;
        researchThermo.setToggleable('llm2', llmRankingOn);

        researchThermo.onToggle = async (key, enabled) => {
          if (key === 'webS') {
            saveSetting('useWebSearch', enabled);
            try {
              const { setWebSearch } = await import("../utils/settings-manager.js");
              await setWebSearch(enabled, { silent: true });
              showMessage(enabled ? 'Web search ON' : 'Web search OFF');
            } catch (e) { showMessage(`Failed: ${e.message}`, "error"); }
          } else if (key === 'llm2') {
            saveSetting('useLlmRanking', enabled);
            showMessage(enabled ? 'LLM ranking ON' : 'LLM ranking OFF');
          }
        };
      }
    }

    showView("results");
  } catch (err) { showMessage(`Error: ${err.message}`, "error"); }
}

