// Entry point
import { AppOrchestrator } from "../shared-services/app.orchestrator.js";
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";
import { ServerConfig } from "../utils/serverConfig.js";
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
  initializeServerStatus();

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
    const app = new AppOrchestrator();
    await app.init();
    window.app = app; // For debugging
    window.state = state; // Debug access to state manager
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

    // Ensure app is available
    if (!window.app) {
      const { AppOrchestrator } = await import("../shared-services/app.orchestrator.js");
      const app = new AppOrchestrator();
      await app.init();
      window.app = app;
    }

    if (!window.app.reloadMappingModules) {
      throw new Error("Mapping module functionality not available - please refresh the add-in");
    }

    await window.app.reloadMappingModules();

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
      if (!window.app) return;

      trackingBtn.disabled = true;
      trackingBtn.textContent = "Activating...";

      try {
        await window.app.startTracking();
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
      if (window.app?.renewPrompt) {
        window.app.renewPrompt();
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

// Server status functionality (inlined from ServerStatusManager)
function initializeServerStatus() {
  // Set initial server host from existing service configuration
  const backendUrl = ServerConfig.getHost();
  state.set("server.host", backendUrl);

  // Set up server input handlers
  setupServerEventHandlers();

  // Initial server status check
  checkServerStatus();
}

function setupServerEventHandlers() {
  // LED click to refresh status
  document.addEventListener("click", (e) => {
    if (e.target.closest("#server-status-led")) {
      e.preventDefault();
      checkServerStatus();
    }
  });

  // API key input
  const apiKeyInput = document.getElementById("api-key-input");
  if (apiKeyInput) {
    apiKeyInput.addEventListener("input", (e) => {
      state.set("server.apiKey", e.target.value.trim());
    });
  }

  // Server URL input
  const serverUrlInput = document.getElementById("server-url-input");
  if (serverUrlInput) {
    serverUrlInput.addEventListener("input", (e) => {
      state.set("server.host", e.target.value.trim());
    });
  }

  // Subscribe to server state changes for LED updates
  state.subscribe("server", (server) => {
    try {
      updateServerLED(server.online, server.host);
      updateCloudIndicator(server.info);
    } catch (error) {
      console.error("Error updating server UI:", error);
    }
  });
}

let isCheckingServer = false;
async function checkServerStatus() {
  if (isCheckingServer) return;

  isCheckingServer = true;
  const host = ServerConfig.getHost();

  if (!host) {
    isCheckingServer = false;
    return;
  }

  try {
    const headers = ServerConfig.getHeaders();

    // Test basic connection
    const testResponse = await fetch(`${host}/test-connection`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5000),
    });

    const isOnline = testResponse.ok;
    let serverInfo = {};
    let connectionValidation = { basic: isOnline, protected: false, error: null };

    if (isOnline) {
      const data = await testResponse.json();
      serverInfo = {
        connectionType: data.connection_type || "Unknown API",
        connectionUrl: data.connection_url || host,
        environment: data.environment || "unknown",
      };

      // Test protected endpoint if API key available
      if (ServerConfig.getApiKey()) {
        try {
          const protectedResponse = await fetch(`${host}/analyze-patterns`, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({ patterns: ["test"] }),
            signal: AbortSignal.timeout(3000),
          });

          connectionValidation.protected = protectedResponse.ok;

          if (!protectedResponse.ok) {
            if (protectedResponse.status === 401) {
              connectionValidation.error = "API key invalid";
            } else if (protectedResponse.status === 503) {
              connectionValidation.error = "API service unavailable - check API key";
            }
          }
        } catch (protectedError) {
          connectionValidation.error = "Protected endpoints unreachable";
        }
      }
    }

    // Update state
    state.update({
      "server.online": isOnline,
      "server.host": host,
      "server.info": serverInfo,
      "server.validation": connectionValidation,
    });

    // Show specific error messages
    if (!isOnline) {
      state.setStatus("Server connection failed", true);
    } else if (ServerConfig.getApiKey() && !connectionValidation.protected) {
      state.setStatus(connectionValidation.error || "API endpoints not accessible", true);
    } else if (!testResponse.ok && testResponse.status === 401) {
      state.setStatus("API key required or invalid", true);
    }
  } catch (error) {
    state.update({
      "server.online": false,
      "server.host": host,
      "server.info": {},
      "server.validation": { basic: false, protected: false, error: error.message },
    });
    state.setStatus(`Connection error: ${error.message}`, true);
  } finally {
    isCheckingServer = false;
  }
}

function updateServerLED(isOnline, host) {
  const led = document.getElementById("server-status-led");
  if (!led) return;

  led.className = `status-led ${isOnline ? "online" : "offline"}`;

  const status = isOnline ? "Online" : "Offline";
  const serverInfo = state.get("server.info") || {};

  const tooltipText =
    isOnline && serverInfo.connectionType && serverInfo.connectionUrl
      ? `${serverInfo.connectionType}\n${serverInfo.connectionUrl}\nStatus: ${status}\nClick to refresh`
      : `Server: ${host || "Unknown"}\nStatus: ${status}\nClick to refresh`;

  led.title = tooltipText;
}

function updateCloudIndicator(serverInfo) {
  const cloudIndicator = document.getElementById("cloud-indicator");
  if (!cloudIndicator) return;

  const isCloudAPI = serverInfo?.connectionType === "Cloud API";
  cloudIndicator.classList.toggle("hidden", !isCloudAPI);
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
  const versionEnvironment = document.getElementById("version-environment");
  const versionRuntime = document.getElementById("version-runtime");

  if (versionNumber) {
    versionNumber.textContent = VersionInfo.getVersionString();
  }

  if (versionBuild) {
    versionBuild.textContent = VersionInfo.getGitInfo();
    versionBuild.title = `Repository: ${info.repository}\nCommit: ${repo.commitUrl}\nCommit Date: ${info.commitDate}\nBranch: ${info.branch}\nBuild Time: ${info.buildTime}`;
  }

  if (versionEnvironment) {
    versionEnvironment.textContent = info.environment;
    versionEnvironment.style.color = info.environment === "development" ? "#0078d7" : "#5cb85c";
    versionEnvironment.style.fontWeight = "500";
  }

  if (versionRuntime) {
    versionRuntime.textContent = info.buildTime;
    versionRuntime.title = `Cache verification: ${info.timestamp}\nRepository: ${repo.url}`;
  }
}
