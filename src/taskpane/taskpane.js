import { startTracking } from "../services/live-tracker.js";
import { init as initHistory, updateHistoryTabCounter } from "../ui-components/processing-history.js";
import { init as initDirectPrompt } from "../ui-components/direct-prompt.js";
import { init as initCandidates } from "../ui-components/candidate-ranking.js";
import { init as initSettingsPanel } from "../ui-components/settings-panel.js";
import { Thermometer } from "../ui-components/thermometer.js";
import { setupServerEvents, checkServerStatus } from "../utils/api-fetch.js";
import { initializeHistoryCache } from "../utils/history-cache.js";
import { initializeSettings } from "../services/workflows.js";
import { saveSetting } from "../utils/settings-manager.js";
import { getStateValue } from "../core/state-actions.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { initializeProjectPathDisplay } from "../utils/app-utilities.js";
import { $, showView, setupButton, openModal, closeModal } from "../utils/dom-helpers.js";
import { setupFileHandling, loadStaticConfig } from "../ui-components/file-handling.js";
import { showMessage, updateAllIndicators, setupIndicators } from "../utils/ui-feedback.js";
const refresh = () => { updateAllIndicators(); updateButtonStates(); };

let researchThermo = null;

// Wizard state machine - centralizes all setup wizard progression logic
export const wizardState = {
  step: 1,
  thermo: null,

  init(thermo) {
    this.thermo = thermo;
    this.step = 1;
  },

  // Auto-advance: only moves forward, ignores requests to go backward
  advance(targetStep) {
    if (!this.thermo || targetStep <= this.step) return;
    this.step = targetStep;
    this._updateUI();
  },

  // Manual navigation: allows going to any step (for user clicks)
  goTo(targetStep) {
    if (!this.thermo || !targetStep) return;
    this.step = targetStep;
    this._updateUI();
  },

  _updateUI() {
    this.thermo.setStep(this.step);
    document.querySelectorAll(".step-panel").forEach(p =>
      p.classList.toggle("active", p.dataset.step === String(this.step))
    );
  },

  reset() {
    this.step = 1;
    if (this.thermo) {
      this.thermo.reset();
      this.thermo.expand();
    }
  },

  completeAndCollapse() {
    if (this.thermo) {
      this.thermo.completeAll();
      this.thermo.collapse();
    }
  },

  // Event handlers - centralized progression rules
  onServerOnline() { this.advance(2); },
  onConfigLoaded() { this.advance(3); },
  onMappingsLoaded(loadedCount, totalCount) {
    if (totalCount > 0 && loadedCount >= totalCount) this.advance(4);
  }
};

function setupUIReactivity() {
  [Events.SERVER_STATUS_CHANGED, Events.MAPPINGS_LOADED, Events.SETTING_CHANGED].forEach(e => eventBus.on(e, refresh));
  eventBus.on(Events.CONFIG_LOADED, updateButtonStates);

  // Wizard progression via state machine
  eventBus.on(Events.SERVER_STATUS_CHANGED, ({ online }) => online && wizardState.onServerOnline());
  eventBus.on(Events.CONFIG_LOADED, () => wizardState.onConfigLoaded());
  eventBus.on(Events.MAPPINGS_LOADED, () => {
    const loaded = Object.keys(getStateValue('mappings.sources') || {}).length;
    const total = getStateValue('config.data')?.standard_mappings?.length || 0;
    wizardState.onMappingsLoaded(loaded, total);
  });

  refresh();
}

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) return $("sideload-msg").textContent = "This add-in requires Microsoft Excel";

  initHistory(); initDirectPrompt(); initCandidates(); updateHistoryTabCounter();
  $("sideload-msg")?.classList.add("hidden");
  const appBody = $("app-body");
  if (appBody) { appBody.classList.remove("hidden"); appBody.classList.add("app-body--active"); }

  wizardState.init(Thermometer.init('setup-thermo'));
  initializeSettings(); setupFileHandling(); setupServerEvents(); setupIndicators();
  eventBus.on(Events.SERVER_RECONNECTED, () => initializeHistoryCache());
  setupUIReactivity();
  checkServerStatus(); initializeProjectPathDisplay();
  initSettingsPanel();

  // Settings slide panel handlers
  const openSettings = () => {
    $("settings-slide-panel")?.classList.add("active");
    $("settings-overlay")?.classList.remove("hidden");
    eventBus.emit(Events.SETTINGS_PANEL_OPENED);
  };
  const closeSettings = () => {
    $("settings-slide-panel")?.classList.remove("active");
    $("settings-overlay")?.classList.add("hidden");
  };
  setupButton("settings-icon-btn", openSettings);
  setupButton("close-settings-btn", closeSettings);
  $("settings-overlay")?.addEventListener("click", closeSettings);

  setupButton("offline-mode-warning", () => { openSettings(); showMessage("Offline mode active - re-enable in Settings"); });
  setupButton("close-hero-btn", () => $("home-hero")?.classList.add("hidden"));

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
    if (tab) { e.preventDefault(); showView(tab.dataset.view); }

    // Collapsed thermometer bubble click - re-expand setup
    const collapsed = e.target.closest(".thermo__collapsed");
    if (collapsed && collapsed.closest("#setup-thermo")) {
      wizardState.thermo?.expand();
      showView("home");
      return;
    }

    const step = e.target.closest(".thermo__step");
    // Only switch panels for setup thermometer, not research thermometer
    if (step && step.closest("#setup-thermo") && wizardState.thermo) {
      e.preventDefault();
      wizardState.thermo.expand();
      showView("home");
      wizardState.goTo(parseInt(step.dataset.step));
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
    wizardState.completeAndCollapse();
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

