import { startTracking } from "../services/live.tracker.js";
import { renewPrompt } from "../services/aiPromptRenewer.js";
import { init as initActivityFeed, updateHistoryTabCounter } from "../ui-components/ActivityFeedUI.js";
import { setupServerEvents, checkServerStatus } from "../utils/server-utilities.js";
import { state, onStateChange, initializeSettings, saveSetting } from "../shared-services/state-machine.manager.js";
import { initializeVersionDisplay, initializeProjectPathDisplay, updateContentMargin } from "../utils/app-utilities.js";
import { showView } from "../ui-components/view-manager.js";
import { setupFileHandling, loadStaticConfig } from "../ui-components/file-handling.js";
import { showMessage } from "../utils/error-display.js";
import { updateLED, setupLED } from "../utils/led-indicator.js";
import { updateMatcherIndicator, setupMatcherIndicator } from "../utils/matcher-indicator.js";

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) {
    document.getElementById("sideload-msg").textContent = "This add-in requires Microsoft Excel";
    return;
  }

  document.body.className = "ms-font-m ms-welcome ms-Fabric";

  initActivityFeed();
  updateHistoryTabCounter();

  const [sideloadMsg, appBody] = ["sideload-msg", "app-body"].map((id) => document.getElementById(id));
  sideloadMsg.style.display = "none";
  appBody.style.display = "flex";

  // Initialize settings from localStorage
  initializeSettings();

  setupFileHandling();
  setupServerEvents();
  setupLED();
  setupMatcherIndicator();
  checkServerStatus();
  updateLED();
  updateMatcherIndicator();
  initializeVersionDisplay();
  initializeProjectPathDisplay();

  // Setup settings checkbox handlers
  const requireServerCheckbox = document.getElementById("require-server-online");
  if (requireServerCheckbox) {
    requireServerCheckbox.checked = state.settings.requireServerOnline;
    requireServerCheckbox.addEventListener("change", (e) => {
      saveSetting("requireServerOnline", e.target.checked);
      updateButtonStates();
      updateLED();
      updateMatcherIndicator();
      showMessage(`Server requirement ${e.target.checked ? "enabled" : "disabled"}`);
    });
  }

  const useBraveApiCheckbox = document.getElementById("use-brave-api");
  if (useBraveApiCheckbox) {
    useBraveApiCheckbox.checked = state.settings.useBraveApi;
    useBraveApiCheckbox.addEventListener("change", async (e) => {
      const enabled = e.target.checked;
      saveSetting("useBraveApi", enabled);

      // Update backend setting
      try {
        const { setBraveApi } = await import("../utils/settings-manager.js");
        await setBraveApi(enabled);
        showMessage(`Brave API ${enabled ? "enabled" : "disabled (testing fallbacks)"}`);
      } catch (error) {
        showMessage(`Failed to update Brave API setting: ${error.message}`, "error");
        // Revert checkbox on error
        e.target.checked = !enabled;
      }
    });
  }

  const offlineWarning = document.getElementById("offline-mode-warning");
  if (offlineWarning) {
    offlineWarning.addEventListener("click", () => {
      showView("settings");
      showMessage("Offline mode active - re-enable server requirement in Connection Requirements");
    });
  }
  document.getElementById("show-metadata-btn")?.addEventListener("click", () => {
    const content = document.getElementById("metadata-content");
    content &&
      (content.classList.toggle("hidden")
        ? (document.getElementById("show-metadata-btn").textContent = "Show Processing Details")
        : (document.getElementById("show-metadata-btn").textContent = "Hide Processing Details"));
  });

  document.getElementById("setup-map-tracking")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Activating...";
    try {
      await startLiveTracking();
    } catch (error) {
      showMessage(`Activation failed: ${error.message}`, "error");
    } finally {
      e.target.disabled = false;
      e.target.textContent = "Activate Tracking";
    }
  });

  document.getElementById("renew-prompt")?.addEventListener("click", () => renewPromptHandler());

  document.addEventListener("click", async (e) => {
    const navTab = e.target.closest(".nav-tab");
    if (navTab) {
      e.preventDefault();
      const viewName = navTab.getAttribute("data-view");
      showView(viewName);
      if (viewName === "settings") {
        await initializeLlmSettings();
      }
    }
  });

  onStateChange((newState) => {
    console.log("State changed:", {
      mappingsLoaded: newState.mappings.loaded,
      sourceCount: Object.keys(newState.mappings.sources).length,
      syncedCount: Object.values(newState.mappings.sources).filter((s) => s.status === "synced").length,
    });
    updateLED();
    updateMatcherIndicator();
    updateButtonStates();
  });

  window.showView = showView;

  updateContentMargin();
  const statusMessage = document.getElementById("main-status-message");
  if (statusMessage) {
    const observer = new MutationObserver(updateContentMargin);
    observer.observe(statusMessage, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  window.addEventListener("resize", updateContentMargin);
  try {
    await loadStaticConfig();
    Object.assign(window, { state, mappingModules: [] });
  } catch (error) {
    console.error("Failed to initialize:", error);
    showMessage(`Initialization failed: ${error.message}`, "error");
  }
});

function canActivateTracking() {
  const { config, mappings, server, settings } = state;

  if (!config.loaded) {
    return { allowed: false, reason: "Configuration not loaded - load config file first" };
  }

  if (!mappings.loaded || !mappings.combined) {
    return { allowed: false, reason: "Mappings not loaded - load mapping files first" };
  }

  const forward = mappings.combined?.forward || {};
  const reverse = mappings.combined?.reverse || {};
  if (Object.keys(forward).length === 0 && Object.keys(reverse).length === 0) {
    return { allowed: false, reason: "No mapping data available - check mapping files" };
  }

  if (settings.requireServerOnline && !server.online) {
    return {
      allowed: false,
      reason: "Server connection required (change in Settings to allow offline mode)"
    };
  }

  if (!server.online) {
    return {
      allowed: true,
      warning: "⚠️ Server offline - only exact/fuzzy matching available (no LLM)"
    };
  }

  return { allowed: true };
}

function updateButtonStates() {
  const activateBtn = document.getElementById("setup-map-tracking");
  if (!activateBtn) return;

  const validation = canActivateTracking();
  activateBtn.disabled = !validation.allowed;

  if (!validation.allowed) {
    activateBtn.title = validation.reason;
    activateBtn.classList.add("disabled-with-reason");
  } else {
    activateBtn.title = "Start live cell tracking";
    activateBtn.classList.remove("disabled-with-reason");
  }
}

async function startLiveTracking() {
  await checkServerStatus();

  const validation = canActivateTracking();

  if (!validation.allowed) {
    return showMessage(`❌ ${validation.reason}`, "error");
  }

  if (validation.warning) {
    showMessage(validation.warning);
  }

  try {
    const config = state.config.data;
    const mappings = state.mappings.combined;
    const termCount = Object.keys(mappings.reverse || {}).length;

    await startTracking(config, mappings);

    const status = state.server.online
      ? `✅ Tracking active: ${termCount} terms (exact/fuzzy/LLM enabled)`
      : `✅ Tracking active: ${termCount} terms (exact/fuzzy only - server offline)`;

    showMessage(status);
    showView("results");
  } catch (error) {
    showMessage(`Error: ${error.message}`, "error");
  }
}

async function renewPromptHandler() {
  const config = state.config.data;
  if (!config) return showMessage("Config not loaded", "error");

  const mappings = state.mappings.combined;
  await renewPrompt(mappings, config, (msg, isError) => showMessage(msg, isError ? "error" : "info"));
}

async function initializeLlmSettings() {
  const providerSelect = document.getElementById("llm-provider-select");
  const modelInput = document.getElementById("llm-model-input");
  const applyBtn = document.getElementById("apply-llm-settings");

  try {
    const { loadAvailableProviders, saveLlmProvider } = await import("../utils/settings-manager.js");
    const data = await loadAvailableProviders();

    if (!data || !data.available_providers) {
      providerSelect.innerHTML = '<option value="">Server offline</option>';
      modelInput.disabled = true;
      applyBtn.disabled = true;
      return;
    }

    providerSelect.innerHTML = data.available_providers.map(p =>
      `<option value="${p}" ${p === data.current_provider ? 'selected' : ''}>${p}</option>`
    ).join('');
    modelInput.value = data.current_model || '';
    modelInput.disabled = false;
    applyBtn.disabled = false;

    applyBtn.onclick = async () => {
      const provider = providerSelect.value;
      const model = modelInput.value.trim();
      if (!provider || !model) return showMessage("Provider and model required", "error");

      try {
        await saveLlmProvider(provider, model);
        showMessage(`LLM provider set to ${provider}`, "success");
      } catch (err) {
        showMessage(`Failed to set provider: ${err.message}`, "error");
      }
    };
  } catch (error) {
    console.error("Failed to initialize LLM settings:", error);
    providerSelect.innerHTML = '<option value="">Error loading</option>';
  }
}
