// Entry point
import { LiveTracker } from "../services/live.tracker.js";
import { aiPromptRenewer } from "../services/aiPromptRenewer.js";
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";
import { setupServerEvents, checkServerStatus } from "../services/server-status-functions.js";
import { state } from "../shared-services/state.manager.js";
import { VersionInfo } from "../utils/version.js";
import { getApiKey } from "../utils/serverConfig.js";
import { updateContentMargin, getCurrentWorkbookName } from "../utils/app-utilities.js";
import { showView } from "../ui-components/view-manager.js";
import { setupFileHandling, reloadMappingModules } from "../ui-components/file-handling.js";

// No theme system - using default only


Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) {
    document.getElementById("sideload-msg").textContent = "This add-in requires Microsoft Excel";
    return;
  }

  // Apply default styling only
  document.body.className = 'ms-font-m ms-welcome ms-Fabric';

  ActivityFeed.init();

  // Hide loading, show app
  const [sideloadMsg, appBody] = ["sideload-msg", "app-body"].map(id => document.getElementById(id));
  sideloadMsg.style.display = "none";
  appBody.style.display = "flex";

  // No theme selector functionality needed - default only

  // Set up file handling (drag/drop)
  setupFileHandling();

  // Initialize server status and version, set up event bindings
  setupServerEvents();
  checkServerStatus();
  VersionInfo.initializeDisplay();
  
  // Event bindings - metadata toggle, tracking, renew, navigation
  document.getElementById("show-metadata-btn")?.addEventListener("click", () => {
    const content = document.getElementById("metadata-content");
    content && (content.classList.toggle("hidden") ? document.getElementById("show-metadata-btn").textContent = "Show Processing Details" : document.getElementById("show-metadata-btn").textContent = "Hide Processing Details");
  });
  
  document.getElementById("setup-map-tracking")?.addEventListener("click", async (e) => {
    if (!getApiKey()?.trim()) return state.setStatus("API key is required to activate tracking. Please set your API key in Settings.", true);
    e.target.disabled = true; e.target.textContent = "Activating...";
    try { await startTracking(); } catch (error) { state.setStatus(`Activation failed: ${error.message}`, true); }
    finally { e.target.disabled = false; e.target.textContent = "Activate Tracking"; }
  });
  
  document.getElementById("renew-prompt")?.addEventListener("click", () => window.aiRenewer ? renewPrompt() : state.setStatus("Application not ready - please refresh", true));
  
  document.addEventListener("click", (e) => {
    const navTab = e.target.closest(".nav-tab");
    if (navTab) {
      e.preventDefault();
      showView(navTab.getAttribute("data-view"));
    }
  });

  // Set up status display FIRST - ensures it works even if initialization fails
  state.subscribe("ui", (ui) => {
    const statusElement = document.getElementById("main-status-message");
    statusElement && (statusElement.textContent = ui.statusMessage, statusElement.style.color = ui.isError ? "#D83B01" : "") || console.warn("Status element not found:", ui.statusMessage);
  });

  // Set up UI infrastructure BEFORE app initialization - environment agnostic
  window.showView = showView; // Make showView globally available for compatibility

  // Initial margin update
  updateContentMargin();

  // Update margin when status content changes - only if element exists
  const statusMessage = document.getElementById("main-status-message");
  if (statusMessage) {
    const observer = new MutationObserver(updateContentMargin);
    observer.observe(statusMessage, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  // Update margin on window resize
  window.addEventListener("resize", updateContentMargin);

  // App initialization - can fail without breaking UI infrastructure
  try {
    await reloadConfig();
    // Set up global references for debugging
    Object.assign(window, { state, tracker: new LiveTracker(), aiRenewer: new aiPromptRenewer((msg, isError) => state.setStatus(msg, isError)), mappingModules: [] });
  } catch (error) {
    console.error("Failed to initialize:", error);
    state.setStatus(`Initialization failed: ${error.message}`, true);
    // UI infrastructure still works - users can still navigate, see status, etc.
  }
});





// Functions moved from AppOrchestrator
async function reloadConfig() {
  try {
    // Get current workbook name
    const workbook = await getCurrentWorkbookName();

    // Try to load config file
    let currentConfigData = state.get("config.raw");
    if (!currentConfigData) {
      currentConfigData = (await import("../../config/app.config.json")).default;
      state.set("config.raw", currentConfigData);
    }

    if (!currentConfigData?.["excel-projects"]) {
      throw new Error("Configuration file not found - please drag and drop a config file");
    }

    const config = currentConfigData["excel-projects"][workbook] || currentConfigData["excel-projects"]["*"];
    if (!config?.standard_mappings?.length) {
      throw new Error(`No valid configuration found for workbook: ${workbook}`);
    }

    state.setConfig({ ...config, workbook });
    await reloadMappingModules();

    state.setStatus(`Config reloaded - Found ${config.standard_mappings.length} standard mapping(s)`);
  } catch (error) {
    let errorMessage = `Config failed: ${error.message}`;
    if (error.message.includes("No valid configuration found for workbook:")) {
      const configData = state.get("config.raw");
      const keys = Object.keys(configData?.["excel-projects"] || {});
      keys.length && (errorMessage += `\n\nAvailable keys: [${keys.join(", ")}] or add "*" as fallback`);
    }
    state.setStatus(errorMessage, true);
    throw error;
  }
}

async function startTracking() {
  const config = state.get("config.data");
  const mappings = state.get("mappings");

  if (!config || (!mappings.forward && !mappings.reverse)) return state.setStatus("Error: Config or mappings missing", true);

  try {
    await window.tracker.start(config, mappings);
    state.setStatus("Tracking active");
    showView("results");
  } catch (error) {
    state.setStatus(`Error: ${error.message}`, true);
  }
}

async function renewPrompt() {
  const config = state.get("config.data");
  if (!config) return state.setStatus("Config not loaded", true);

  const button = document.getElementById("renew-prompt");
  const label = button?.querySelector(".ms-Button-label");
  const originalText = label?.textContent || "Renew Prompt 🤖";
  let cancelled = false;

  const cancelHandler = () => {
    cancelled = true;
    state.setStatus("Generation cancelled");
  };

  if (button) {
    button.removeEventListener("click", renewPrompt);
    button.addEventListener("click", cancelHandler);
  }
  if (label) label.textContent = "Cancel Generation";

  try {
    const mappings = state.get("mappings");
    await window.aiRenewer.renewPrompt(mappings, config, () => cancelled);
  } finally {
    if (button) {
      button.removeEventListener("click", cancelHandler);
      button.addEventListener("click", () => renewPrompt());
    }
    if (label) label.textContent = originalText;
  }
}


