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
import { showView } from "../utils/dom-helpers.js";
import { setupFileHandling, loadStaticConfig } from "../ui-components/file-handling.js";
import { showMessage } from "../utils/error-display.js";
import { updateLED, setupLED } from "../utils/led-indicator.js";
import { updateMatcherIndicator, setupMatcherIndicator } from "../utils/matcher-indicator.js";
import { updateWarnings } from "../utils/warning-manager.js";
import { setupButton } from "../utils/dom-helpers.js";

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
  const validation = canActivateTracking();
  if (!validation.allowed) return showMessage(`❌ ${validation.reason}`, "error");
  if (validation.warning) showMessage(validation.warning);

  try {
    const config = getStateValue('config.data'), mappings = getStateValue('mappings.combined');
    const termCount = Object.keys(mappings.reverse || {}).length;
    const trackingInfo = await startTracking(config, mappings);

    let statusParts = [];
    const serverOnline = getStateValue('server.online');
    statusParts.push(serverOnline ? `✅ Tracking active: ${termCount} terms (exact/fuzzy/LLM enabled)` : `✅ Tracking active: ${termCount} terms (exact/fuzzy only - server offline)`);

    if (trackingInfo.confidenceTotal > 0) {
      const { confidenceTotal, confidenceMapped, confidenceFound, confidenceMissing } = trackingInfo;
      if (confidenceMapped === confidenceTotal) {
        statusParts.push(`✅ Confidence: ${confidenceTotal} columns active`);
        if (confidenceFound.length) statusParts.push(`   Mapped: ${confidenceFound.join(", ")}`);
      } else {
        statusParts.push(`⚠️ Confidence: ${confidenceMapped}/${confidenceTotal} columns active`);
        if (confidenceFound.length) statusParts.push(`   ✅ Found: ${confidenceFound.join(", ")}`);
        if (confidenceMissing.length) statusParts.push(`   ❌ Missing: ${confidenceMissing.join(", ")}`);
      }
    }

    showMessage(statusParts.join("\n"));
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
  const setupCheckbox = (id, settingKey, onChange) => {
    const checkbox = document.getElementById(id);
    if (!checkbox) return;
    checkbox.checked = getStateValue(`settings.${settingKey}`);
    checkbox.addEventListener("change", (e) => onChange(e.target.checked, e.target));
  };

  setupCheckbox("require-server-online", "requireServerOnline", (checked) => {
    saveSetting("requireServerOnline", checked);
    updateButtonStates(); updateLED(); updateMatcherIndicator();
    showMessage(`Server requirement ${checked ? "enabled" : "disabled"}`);
  });

  setupCheckbox("use-web-search", "useWebSearch", async (checked, target) => {
    saveSetting("useWebSearch", checked);
    try {
      const { setWebSearch } = await import("../utils/settings-manager.js");
      await setWebSearch(checked);
      showMessage(`Web search ${checked ? "enabled" : "disabled (LLM only mode)"}`);
    } catch (error) { showMessage(`Failed to update web search setting: ${error.message}`, "error"); target.checked = !checked; }
  });

  setupCheckbox("use-brave-api", "useBraveApi", async (checked, target) => {
    saveSetting("useBraveApi", checked);
    try {
      const { setBraveApi } = await import("../utils/settings-manager.js");
      await setBraveApi(checked);
      showMessage(`Brave API ${checked ? "enabled" : "disabled (testing fallbacks)"}`);
    } catch (error) { showMessage(`Failed to update Brave API setting: ${error.message}`, "error"); target.checked = !checked; }
  });
}
