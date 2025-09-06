// Entry point
import { LiveTracker } from "../services/live.tracker.js";
import { aiPromptRenewer } from "../services/aiPromptRenewer.js";
import { createMappingConfigHTML, setupMappingConfigEvents, loadMappingConfigData } from "../ui-components/mapping-config-functions.js";
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";
import { ServerStatusManager } from "../services/server.status.js";
import { state } from "../shared-services/state.manager.js";
import { VersionInfo } from "../utils/version.js";

// No theme system - using default only

// Function to update content margin based on status bar height
function updateContentMargin() {
  const statusBar = document.querySelector(".status-bar");
  if (statusBar) {
    const statusBarHeight = statusBar.offsetHeight;
    document.documentElement.style.setProperty("--status-bar-height", `${statusBarHeight}px`);
  }
}

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) {
    document.getElementById("sideload-msg").textContent = "This add-in requires Microsoft Excel";
    return;
  }

  // Apply default styling only
  document.body.className = `ms-font-m ms-welcome ms-Fabric`;

  ActivityFeed.init();

  // Hide loading, show app
  document.getElementById("sideload-msg").style.display = "none";
  document.getElementById("app-body").style.display = "flex";

  // No theme selector functionality needed - default only

  // Set up ultra-simple drag/drop
  setupSimpleDragDrop();

  // Set up direct event bindings
  setupDirectEventBindings();

  // Initialize server status
  const serverStatusManager = new ServerStatusManager();
  serverStatusManager.initialize();

  // Initialize version information display
  initializeVersionDisplay();

  // Set up status display FIRST - ensures it works even if initialization fails
  state.subscribe("ui", (ui) => {
    const statusElement = document.getElementById("main-status-message");
    if (statusElement) {
      statusElement.textContent = ui.statusMessage;
      statusElement.style.color = ui.isError ? "#D83B01" : "";
    } else {
      // Cloud Excel fallback: log when DOM element is missing
      console.warn("Status element not found during update:", ui.statusMessage);
    }
  });

  // Set up UI infrastructure BEFORE app initialization - environment agnostic
  window.showView = showView; // Make showView globally available

  // Initial margin update
  updateContentMargin();

  // Update margin when status content changes
  const observer = new MutationObserver(updateContentMargin);
  const statusMessage = document.getElementById("main-status-message");
  if (statusMessage) {
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
    window.state = state;
    window.tracker = new LiveTracker();
    window.aiRenewer = new aiPromptRenewer((msg, isError) => state.setStatus(msg, isError));
    window.mappingModules = [];
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
    const workbook = await Excel.run(async (context) => {
      const wb = context.workbook;
      wb.load("name");
      await context.sync();
      return wb.name;
    });

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

    // Ensure global objects are available
    if (!window.tracker) {
      window.tracker = new LiveTracker();
    }
    if (!window.aiRenewer) {
      window.aiRenewer = new aiPromptRenewer((msg, isError) => state.setStatus(msg, isError));
    }
    if (!window.mappingModules) {
      window.mappingModules = [];
    }

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

function setupDirectEventBindings() {
  // Toggle metadata button
  const metadataBtn = document.getElementById("show-metadata-btn");
  if (metadataBtn) {
    metadataBtn.addEventListener("click", () => {
      const content = document.getElementById("metadata-content");
      if (content) {
        const isHidden = content.classList.toggle("hidden");
        metadataBtn.textContent = isHidden ? "Show Processing Details" : "Hide Processing Details";
      }
    });
  }

  // Start tracking button - simple implementation
  const trackingBtn = document.getElementById("setup-map-tracking");
  if (trackingBtn) {
    trackingBtn.addEventListener("click", async () => {
      // Import ServerConfig to check API key
      const { getApiKey } = await import("../utils/serverConfig.js");
      const apiKey = getApiKey();

      if (!apiKey || apiKey.trim() === "") {
        state.setStatus("API key is required to activate tracking. Please set your API key in Settings.", true);
        return;
      }

      trackingBtn.disabled = true;
      trackingBtn.textContent = "Activating...";

      try {
        await startTracking();
      } catch (error) {
        state.setStatus(`Activation failed: ${error.message}`, true);
      } finally {
        trackingBtn.disabled = false;
        trackingBtn.textContent = "Activate Tracking";
      }
    });
  }

  // Renew prompt button
  const renewBtn = document.getElementById("renew-prompt");
  if (renewBtn) {
    renewBtn.addEventListener("click", () => {
      if (window.aiRenewer) {
        renewPrompt();
      } else {
        state.setStatus("Application not ready - please refresh", true);
      }
    });
  }

  // Navigation tabs
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      const viewName = tab.getAttribute("data-view");
      showView(viewName);
    });
  });
}

// Simple view switching
function showView(viewName) {
  const views = ["setup-view", "results-view", "history-view", "settings-view"];
  const viewElement = `${viewName}-view`;

  if (!views.includes(viewElement)) return;

  // Hide all views and show selected
  views.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.classList.toggle("hidden", !id.startsWith(viewName));
    }
  });

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
  // Log version info to console for developers
  VersionInfo.logToConsole();

  // Update version display elements when settings view is accessed
  updateVersionDisplay();
}

function updateVersionDisplay() {
  const info = VersionInfo.getEssentialInfo();
  const repo = VersionInfo.getRepositoryInfo();

  // Update version elements with git provenance focus
  const versionNumber = document.getElementById("version-number");
  const versionBuild = document.getElementById("version-build");
  const versionRuntime = document.getElementById("version-runtime");
  const versionBundleSize = document.getElementById("version-bundle-size");

  if (versionNumber) {
    versionNumber.textContent = VersionInfo.getVersionString();
  }

  if (versionBuild) {
    versionBuild.textContent = VersionInfo.getGitInfo();
    versionBuild.title = `Repository: ${info.repository}\nCommit: ${repo.commitUrl}\nCommit Date: ${info.commitDate}\nBranch: ${info.branch}\nBuild Time: ${info.buildTime}`;
  }

  if (versionRuntime) {
    versionRuntime.textContent = info.buildTime;
    versionRuntime.title = `Cache verification: ${info.timestamp}\nRepository: ${repo.url}`;
  }

  if (versionBundleSize) {
    versionBundleSize.textContent = VersionInfo.bundleSize;
    versionBundleSize.title = `Webpack bundle size for taskpane.js\nGenerated during build process`;
  }
}

// Functions moved from AppOrchestrator
async function reloadConfig() {
  try {
    // Get current workbook name
    const workbook = await Excel.run(async (context) => {
      const wb = context.workbook;
      wb.load("name");
      await context.sync();
      return wb.name;
    });

    // Try to load config file
    let currentConfigData = state.get("config.raw");
    if (!currentConfigData) {
      const configModule = await import("../../config/app.config.json");
      currentConfigData = configModule.default || configModule;
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
      if (keys.length > 0) {
        errorMessage += `\n\nAvailable keys: [${keys.join(", ")}] or add "*" as fallback`;
      }
    }
    state.setStatus(errorMessage, true);
    throw error;
  }
}

async function startTracking() {
  const config = state.get("config.data");
  const mappings = state.get("mappings");

  if (!config || (!mappings.forward && !mappings.reverse)) {
    return state.setStatus("Error: Config or mappings missing", true);
  }

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
  if (!config) {
    state.setStatus("Config not loaded", true);
    return;
  }

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

function onMappingLoaded() {
  // Mapping data is now managed directly in state - just update UI
  updateGlobalStatus();
  updateJsonDump();
}

function updateJsonDump() {
  const content = document.getElementById("metadata-content");
  const sources = state.get("mappings.sources") || {};
  if (!content || Object.keys(sources).length === 0) return;

  const data = Object.entries(sources).map(([index, { mappings, result }]) => ({
    sourceIndex: parseInt(index) + 1,
    forwardMappings: Object.keys(mappings.forward || {}).length,
    reverseMappings: Object.keys(mappings.reverse || {}).length,
    metadata: result.metadata,
    mappings: mappings,
  }));

  content.innerHTML = `
    <div style="margin-top: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-family: monospace; font-size: 12px;">
      <strong>Raw Data:</strong>
      <pre style="margin: 5px 0; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(data, null, 2)}</pre>
    </div>`;
}

function updateGlobalStatus() {
  const sources = state.get("mappings.sources") || {};
  const loaded = Object.keys(sources).length;
  const total = window.mappingModules?.length || 0;

  const message =
    loaded === 0
      ? "Ready to load mapping configurations..."
      : loaded === total
        ? `All ${total} mapping sources loaded`
        : `${loaded}/${total} mapping sources loaded`;

  state.setStatus(message);
}
