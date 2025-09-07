import { LiveTracker } from "../services/live.tracker.js";
import { renewPrompt, isRenewing, cancel } from "../services/aiPromptRenewer.js";
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";
import { setupServerEvents, checkServerStatus } from "../services/server-status-functions.js";
import { state } from "../shared-services/state.manager.js";
import { VersionInfo } from "../utils/version.js";
import { getApiKey } from "../utils/serverConfig.js";
import { updateContentMargin, getCurrentWorkbookName } from "../utils/app-utilities.js";
import { showView } from "../ui-components/view-manager.js";
import { setupFileHandling, reloadMappingModules } from "../ui-components/file-handling.js";
import { validateConfigStructure, selectWorkbookConfig, buildConfigErrorMessage } from "../utils/config-processor.js";



Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) {
    document.getElementById("sideload-msg").textContent = "This add-in requires Microsoft Excel";
    return;
  }

  document.body.className = 'ms-font-m ms-welcome ms-Fabric';

  ActivityFeed.init();

  const [sideloadMsg, appBody] = ["sideload-msg", "app-body"].map(id => document.getElementById(id));
  sideloadMsg.style.display = "none";
  appBody.style.display = "flex";

  setupFileHandling();
  setupServerEvents();
  checkServerStatus();
  VersionInfo.initializeDisplay();
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
  
  document.getElementById("renew-prompt")?.addEventListener("click", () => renewPromptHandler());
  
  document.addEventListener("click", (e) => {
    const navTab = e.target.closest(".nav-tab");
    if (navTab) {
      e.preventDefault();
      showView(navTab.getAttribute("data-view"));
    }
  });

  state.subscribe("ui", (ui) => {
    const statusElement = document.getElementById("main-status-message");
    statusElement && (statusElement.textContent = ui.statusMessage, statusElement.style.color = ui.isError ? "#D83B01" : "") || console.warn("Status element not found:", ui.statusMessage);
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
    await reloadConfig();
    Object.assign(window, { state, tracker: new LiveTracker(), mappingModules: [] });
  } catch (error) {
    console.error("Failed to initialize:", error);
    state.setStatus(`Initialization failed: ${error.message}`, true);
  }
});





async function reloadConfig() {
  try {
    const workbook = await getCurrentWorkbookName();
    
    let configData = state.get("config.raw");
    if (!configData) {
      configData = (await import("../../config/app.config.json")).default;
      state.set("config.raw", configData);
    }

    validateConfigStructure(configData);
    const config = selectWorkbookConfig(configData, workbook);
    
    state.setConfig(config);
    await reloadMappingModules();
    state.setStatus(`Config reloaded - Found ${config.standard_mappings.length} standard mapping(s)`);
  } catch (error) {
    const configData = state.get("config.raw");
    const errorMessage = buildConfigErrorMessage(error, configData);
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

async function renewPromptHandler() {
  const config = state.get("config.data");
  if (!config) return state.setStatus("Config not loaded", true);

  const mappings = state.get("mappings");
  await renewPrompt(mappings, config, (msg, isError) => state.setStatus(msg, isError));
}


