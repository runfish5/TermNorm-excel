import { startTracking } from "../services/live.tracker.js";
import { renewPrompt } from "../services/aiPromptRenewer.js";
import { init as initProcessingHistory, updateHistoryTabCounter } from "../ui-components/ProcessingHistoryUI.js";
import { init as initBatchProcessing } from "../ui-components/BatchProcessingUI.js";
import { setupServerEvents, checkServerStatus } from "../utils/server-utilities.js";
import { initializeHistoryCache } from "../utils/history-cache.js";
import { initializeSettings, saveSetting } from "../shared-services/state-machine.manager.js";
import { getStateValue } from "../core/state-actions.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { initializeVersionDisplay, initializeProjectPathDisplay, updateContentMargin } from "../utils/app-utilities.js";
import { showView, setupButton } from "../utils/dom-helpers.js";
import { setupFileHandling, loadStaticConfig } from "../ui-components/file-handling.js";
import { showMessage } from "../utils/error-display.js";
import { updateLED, setupLED } from "../utils/led-indicator.js";
import { updateMatcherIndicator, setupMatcherIndicator } from "../utils/matcher-indicator.js";
import { updateWarnings } from "../utils/warning-manager.js";

function setupUIReactivity() {
  eventBus.on(Events.SERVER_STATUS_CHANGED, () => { updateLED(); updateMatcherIndicator(); updateWarnings(); updateButtonStates(); });
  eventBus.on(Events.MAPPINGS_LOADED, () => { updateMatcherIndicator(); updateButtonStates(); });
  eventBus.on(Events.SETTING_CHANGED, () => { updateWarnings(); updateButtonStates(); });
  eventBus.on(Events.CONFIG_LOADED, () => updateButtonStates());
  updateLED(); updateMatcherIndicator(); updateWarnings(); updateButtonStates();
}

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) {
    document.getElementById("sideload-msg").textContent = "This add-in requires Microsoft Excel";
    return;
  }

  document.body.className = "ms-font-m ms-welcome ms-Fabric";
  initProcessingHistory(); initBatchProcessing(); updateHistoryTabCounter();

  document.getElementById("sideload-msg")?.classList.add("hidden");
  const appBody = document.getElementById("app-body");
  if (appBody) { appBody.classList.remove("hidden"); appBody.style.display = "flex"; }

  initializeSettings();
  setupFileHandling(); setupServerEvents(); setupLED(); setupMatcherIndicator();
  eventBus.on(Events.SERVER_RECONNECTED, () => initializeHistoryCache());
  setupUIReactivity();
  checkServerStatus(); initializeVersionDisplay(); initializeProjectPathDisplay();
  setupSettingsCheckboxes();

  setupButton("offline-mode-warning", () => { showView("settings"); showMessage("Offline mode active - re-enable server requirement in Connection Requirements"); });

  document.getElementById("show-metadata-btn")?.addEventListener("click", () => {
    const content = document.getElementById("metadata-content");
    if (content) {
      content.classList.toggle("hidden");
      document.getElementById("show-metadata-btn").textContent = content.classList.contains("hidden") ? "Show Processing Details" : "Hide Processing Details";
    }
  });

  const helpModal = document.getElementById("help-modal");
  document.getElementById("help-icon-btn")?.addEventListener("click", () => helpModal?.classList.remove("hidden"));
  document.getElementById("close-help-modal")?.addEventListener("click", () => helpModal?.classList.add("hidden"));
  helpModal?.addEventListener("click", (e) => e.target === helpModal && helpModal.classList.add("hidden"));

  document.getElementById("setup-map-tracking")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Activating...";
    try { await startLiveTracking(); }
    catch (error) { showMessage(`Activation failed: ${error.message}`, "error"); }
    finally { e.target.disabled = false; e.target.textContent = "Activate Tracking"; }
  });

  document.getElementById("renew-prompt")?.addEventListener("click", renewPromptHandler);

  document.addEventListener("click", async (e) => {
    const navTab = e.target.closest(".nav-tab");
    if (navTab) {
      e.preventDefault();
      const viewName = navTab.getAttribute("data-view");
      showView(viewName);
      if (viewName === "settings") await initializeLlmSettings();
    }
  });

  updateContentMargin();
  const statusMessage = document.getElementById("main-status-message");
  if (statusMessage) new MutationObserver(updateContentMargin).observe(statusMessage, { childList: true, subtree: true, characterData: true });
  window.addEventListener("resize", updateContentMargin);

  try { await loadStaticConfig(); }
  catch (error) { console.error("Failed to initialize:", error); showMessage(`Initialization failed: ${error.message}`, "error"); }
});

function canActivateTracking() {
  const configLoaded = getStateValue('config.loaded'), mappingsLoaded = getStateValue('mappings.loaded');
  const mappingsCombined = getStateValue('mappings.combined'), serverOnline = getStateValue('server.online');
  const requireServerOnline = getStateValue('settings.requireServerOnline');

  if (!configLoaded) return { allowed: false, reason: "Configuration not loaded - load config file first" };
  if (!mappingsLoaded || !mappingsCombined) return { allowed: false, reason: "Mappings not loaded - load mapping files first" };

  const forward = mappingsCombined?.forward || {}, reverse = mappingsCombined?.reverse || {};
  if (!Object.keys(forward).length && !Object.keys(reverse).length) return { allowed: false, reason: "No mapping data available - check mapping files" };
  if (requireServerOnline && !serverOnline) return { allowed: false, reason: "Server connection required (change in Settings to allow offline mode)" };
  if (!serverOnline) return { allowed: true, warning: "⚠️ Server offline - only exact/fuzzy matching available (no LLM)" };
  return { allowed: true };
}

function updateButtonStates() {
  const activateBtn = document.getElementById("setup-map-tracking");
  if (!activateBtn) return;
  const validation = canActivateTracking();
  activateBtn.disabled = !validation.allowed;
  activateBtn.title = validation.allowed ? "Start live cell tracking" : validation.reason;
  activateBtn.classList.toggle("disabled-with-reason", !validation.allowed);
}

async function startLiveTracking() {
  await checkServerStatus();
  const v = canActivateTracking();
  if (!v.allowed) return showMessage(`❌ ${v.reason}`, "error");
  if (v.warning) showMessage(v.warning);

  try {
    const config = getStateValue('config.data'), mappings = getStateValue('mappings.combined');
    const terms = Object.keys(mappings.reverse || {}).length, online = getStateValue('server.online');
    const info = await startTracking(config, mappings);

    const status = [`✅ Tracking active: ${terms} terms (${online ? "exact/fuzzy/LLM enabled" : "exact/fuzzy only - server offline"})`];
    if (info.confidenceTotal > 0) {
      const { confidenceTotal: t, confidenceMapped: m, confidenceFound: f, confidenceMissing: x } = info;
      status.push(m === t ? `✅ Confidence: ${t} columns active` : `⚠️ Confidence: ${m}/${t} columns active`);
      if (f.length) status.push(`   ${m === t ? "Mapped" : "✅ Found"}: ${f.join(", ")}`);
      if (x.length) status.push(`   ❌ Missing: ${x.join(", ")}`);
    }
    showMessage(status.join("\n"));
    showView("results");
  } catch (error) { showMessage(`Error: ${error.message}`, "error"); }
}

async function renewPromptHandler() {
  const config = getStateValue('config.data'), mappings = getStateValue('mappings.combined');
  if (!config) return showMessage("Configuration not loaded - load config file first", "error");
  if (!mappings) return showMessage("Mappings not loaded - load mapping files first", "error");
  await renewPrompt(mappings, config, (msg, isError) => showMessage(msg, isError ? "error" : "info"));
}

async function initializeLlmSettings() {
  const providerSelect = document.getElementById("llm-provider-select");
  const modelInput = document.getElementById("llm-model-input");
  const applyBtn = document.getElementById("apply-llm-settings");

  try {
    const { loadAvailableProviders, saveLlmProvider } = await import("../utils/settings-manager.js");
    const data = await loadAvailableProviders();

    if (!data?.available_providers) {
      providerSelect.innerHTML = '<option value="">Server offline</option>';
      modelInput.disabled = applyBtn.disabled = true;
      return;
    }

    providerSelect.innerHTML = data.available_providers.map((p) => `<option value="${p}" ${p === data.current_provider ? "selected" : ""}>${p}</option>`).join("");
    modelInput.value = data.current_model || "";
    modelInput.disabled = applyBtn.disabled = false;

    applyBtn.onclick = async () => {
      const provider = providerSelect.value, model = modelInput.value.trim();
      if (!provider || !model) return showMessage("Provider and model required", "error");
      try { await saveLlmProvider(provider, model); showMessage(`LLM provider set to ${provider}`, "success"); }
      catch (err) { showMessage(`Failed to set provider: ${err.message}`, "error"); }
    };
  } catch (error) { providerSelect.innerHTML = '<option value="">Error loading</option>'; }
}

function setupSettingsCheckboxes() {
  const setup = (id, key, fn) => {
    const cb = document.getElementById(id);
    if (cb) { cb.checked = getStateValue(`settings.${key}`); cb.addEventListener("change", (e) => fn(e.target.checked, e.target)); }
  };

  setup("require-server-online", "requireServerOnline", (checked) => {
    saveSetting("requireServerOnline", checked);
    updateButtonStates(); updateLED(); updateMatcherIndicator();
    showMessage(`Server requirement ${checked ? "enabled" : "disabled"}`);
  });

  const apiCheckbox = async (key, apiFn, msgOn, msgOff) => async (checked, target) => {
    saveSetting(key, checked);
    try { await (await import("../utils/settings-manager.js"))[apiFn](checked); showMessage(checked ? msgOn : msgOff); }
    catch (e) { showMessage(`Failed: ${e.message}`, "error"); target.checked = !checked; }
  };

  setup("use-web-search", "useWebSearch", apiCheckbox("useWebSearch", "setWebSearch", "Web search enabled", "Web search disabled (LLM only mode)"));
  setup("use-brave-api", "useBraveApi", apiCheckbox("useBraveApi", "setBraveApi", "Brave API enabled", "Brave API disabled (testing fallbacks)"));
}
