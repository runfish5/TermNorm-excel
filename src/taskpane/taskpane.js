// Entry point
import { LiveTracker } from "../services/live.tracker.js";
import { aiPromptRenewer } from "../services/aiPromptRenewer.js";
import { createMappingConfigHTML, setupMappingConfigEvents, loadMappingConfigData } from "../ui-components/mapping-config-functions.js";
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";
import { setupServerEvents, checkServerStatus } from "../services/server-status-functions.js";
import { state } from "../shared-services/state.manager.js";
import { VersionInfo } from "../utils/version.js";
import { getApiKey } from "../utils/serverConfig.js";

// No theme system - using default only

// Function to update content margin based on status bar height
function updateContentMargin() {
  const statusBar = document.querySelector(".status-bar");
  if (statusBar) {
    const statusBarHeight = statusBar.offsetHeight;
    document.documentElement.style.setProperty("--status-bar-height", `${statusBarHeight}px`);
  }
}



// Utility function to get current workbook name
async function getCurrentWorkbookName() {
  return await Excel.run(async (context) => {
    const wb = context.workbook;
    wb.load("name");
    await context.sync();
    return wb.name;
  });
}


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

  // Set up ultra-simple drag/drop
  setupSimpleDragDrop();

  // Initialize server status and version, set up event bindings
  setupServerEvents();
  checkServerStatus();
  initializeVersionDisplay();
  
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
  window.showView = showView; // Make showView globally available

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

// Ultra-simple vanilla drag/drop - works in both local and cloud Excel
function setupSimpleDragDrop() {
  const dropZone = document.getElementById("drop-zone");
  if (!dropZone) return;

  // Prevent default browser behavior
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });

  // Highlight drop zone when item is dragged over it
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, highlight, false);
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, unhighlight, false);
  });

  // Handle dropped files
  dropZone.addEventListener("drop", handleDrop, false);

  // Handle click to open file dialog
  dropZone.addEventListener("click", openFileDialog, false);
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function highlight() {
  document.getElementById("drop-zone").classList.add("highlight");
}

function unhighlight() {
  document.getElementById("drop-zone").classList.remove("highlight");
}

function handleDrop(e) {
  const files = e.dataTransfer.files;
  [...files].forEach(processFile);
}

function openFileDialog() {
  // Immediate feedback that dialog was clicked
  state.setStatus("Opening file dialog...");

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      state.setStatus(`File selected: ${file.name} - Processing...`);
      await processFile(file);
    } else {
      state.setStatus("No file selected", true);
    }
  };
  input.click();
}

async function processFile(file) {
  state.setStatus(`Processing file: ${file.name}`);
  try {
    if (!file.name.endsWith(".json")) {
      state.setStatus("Please select a JSON configuration file", true);
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => state.setStatus("Failed to read file - file might be corrupted", true);
    reader.onabort = () => state.setStatus("File reading was aborted", true);

    reader.onload = async function (e) {
      try {
        const configData = JSON.parse(e.target.result);
        await loadConfigData(configData, file.name);
      } catch (error) {
        state.setStatus(`Invalid JSON file - ${error.message}`, true);
      }
    };

    reader.readAsText(file);
  } catch (error) {
    state.setStatus(`File processing failed - ${error.message}`, true);
  }
}

async function loadConfigData(configData, fileName) {
  try {
    if (!configData?.["excel-projects"]) {
      throw new Error("Invalid config format - missing excel-projects structure");
    }

    state.set("config.raw", configData);

    // Get workbook name
    const workbook = await getCurrentWorkbookName();

    // Find matching config
    const config = configData["excel-projects"][workbook] || configData["excel-projects"]["*"];
    const availableWorkbooks = Object.keys(configData["excel-projects"]).join(", ");

    if (!config?.standard_mappings?.length) {
      throw new Error(`No valid configuration found for workbook: "${workbook}". Available: ${availableWorkbooks}`);
    }

    state.setConfig({ ...config, workbook });

    // Ensure UI container exists
    let container = document.getElementById("mapping-configs-container");
    if (!container && window.showView) {
      window.showView("setup");
      await new Promise((resolve) => setTimeout(resolve, 100));
      container = document.getElementById("mapping-configs-container");
    }

    if (!container) {
      throw new Error("Configuration UI container not available - please refresh the add-in");
    }

    // Ensure global objects are available (fallback if not initialized)
    !window.tracker && Object.assign(window, { tracker: new LiveTracker(), aiRenewer: new aiPromptRenewer((msg, isError) => state.setStatus(msg, isError)), mappingModules: [] });

    await reloadMappingModules();

    const finalContainer = document.getElementById("mapping-configs-container");
    if (!finalContainer?.children.length) {
      throw new Error("Module reload completed but no UI elements were created - check configuration");
    }

    state.setStatus(
      `Configuration loaded from ${fileName} - Found ${config.standard_mappings.length} standard mapping(s)`
    );
  } catch (error) {
    state.setStatus(error.message, true);
  }
}


// Simple view switching
function showView(viewName) {
  const views = ["setup-view", "results-view", "history-view", "settings-view"];
  const viewElement = `${viewName}-view`;

  if (!views.includes(viewElement)) return;

  // Hide all views and show selected
  views.forEach((id) => document.getElementById(id)?.classList.toggle("hidden", !id.startsWith(viewName)));

  // Update tab states
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    const isActive = tab.getAttribute("data-view") === viewName;
    tab.classList.toggle("ms-Button--primary", isActive);
  });

  // Update state
  state.set("ui.currentView", viewName);
}

// Version information display
function initializeVersionDisplay() {
  VersionInfo.logToConsole();
  const info = VersionInfo.getEssentialInfo(), repo = VersionInfo.getRepositoryInfo();
  document.getElementById("version-number") && (document.getElementById("version-number").textContent = VersionInfo.getVersionString());
  const buildEl = document.getElementById("version-build"); buildEl && (buildEl.textContent = VersionInfo.getGitInfo(), buildEl.title = `Repository: ${info.repository}\nCommit: ${repo.commitUrl}\nCommit Date: ${info.commitDate}\nBranch: ${info.branch}\nBuild Time: ${info.buildTime}`);
  const runtimeEl = document.getElementById("version-runtime"); runtimeEl && (runtimeEl.textContent = info.buildTime, runtimeEl.title = `Cache verification: ${info.timestamp}\nRepository: ${repo.url}`);
  const bundleEl = document.getElementById("version-bundle-size"); bundleEl && (bundleEl.textContent = VersionInfo.bundleSize, bundleEl.title = "Webpack bundle size for taskpane.js\nGenerated during build process");
}

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
    window.showView?.("results");
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

async function reloadMappingModules() {
  const config = state.get("config.data");
  const standardMappings = config?.standard_mappings || [];

  if (!standardMappings?.length) {
    return;
  }

  const container = document.getElementById("mapping-configs-container");
  if (!container) {
    throw new Error("Mapping configs container not found");
  }

  // Reset state
  container.innerHTML = "";
  window.mappingModules = [];

  // Create new modules using direct functions
  window.mappingModules = standardMappings.map((config, index) => {
    const elementId = `mapping-config-${index}`;
    
    try {
      // Create element
      const element = document.createElement("details");
      element.id = elementId;
      element.className = "ms-welcome__section mapping-config-module";
      element.open = true;
      element.innerHTML = createMappingConfigHTML(config, index);
      
      container.appendChild(element);
      
      // Setup events and get mapping accessor
      const moduleAPI = setupMappingConfigEvents(element, config, index, () => onMappingLoaded());
      
      // Load initial data
      loadMappingConfigData(element, config);
      
      return { element, getMappings: moduleAPI.getMappings, index };
    } catch (initError) {
      state.setStatus(`Module ${index + 1} init failed: ${initError.message}`, true);
      return { element: null, getMappings: () => ({ forward: {}, reverse: {}, metadata: null }), index };
    }
  });

  updateGlobalStatus();
}

function onMappingLoaded() { updateGlobalStatus(); updateJsonDump(); }

function updateJsonDump() {
  const content = document.getElementById("metadata-content"), sources = state.get("mappings.sources") || {};
  if (!content || !Object.keys(sources).length) return;
  content.innerHTML = `<div style="margin-top: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-family: monospace; font-size: 12px;"><strong>Raw Data:</strong><pre style="margin: 5px 0; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(Object.entries(sources).map(([index, { mappings, result }]) => ({ sourceIndex: +index + 1, forwardMappings: Object.keys(mappings.forward || {}).length, reverseMappings: Object.keys(mappings.reverse || {}).length, metadata: result.metadata, mappings })), null, 2)}</pre></div>`;
}

function updateGlobalStatus() {
  const loaded = Object.keys(state.get("mappings.sources") || {}).length, total = window.mappingModules?.length || 0;
  state.setStatus(loaded === 0 ? "Ready to load mapping configurations..." : loaded === total ? `All ${total} mapping sources loaded` : `${loaded}/${total} mapping sources loaded`);
}
