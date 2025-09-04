// Entry point
import { AppOrchestrator } from "../shared-services/app.orchestrator.js";
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";
import { ServerConfig } from "../utils/serverConfig.js";
import { state } from "../shared-services/state.manager.js";

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

  try {
    const app = new AppOrchestrator();
    await app.init();
    window.app = app; // For debugging
    window.showView = showView; // Make showView globally available

    // Set up status display
    state.subscribe("ui", (ui) => {
      const statusElement = document.getElementById("main-status-message");
      if (statusElement) {
        statusElement.textContent = ui.statusMessage;
        statusElement.style.color = ui.isError ? "#D83B01" : "";
      }
    });

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
  } catch (error) {
    console.error("Failed to initialize:", error);
    alert(`Initialization failed: ${error.message}`);
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

function highlight(e) {
  document.getElementById("drop-zone").classList.add("highlight");
}

function unhighlight(e) {
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
  state.setStatus(`PROCESSFILE: Starting to process file: ${file.name}`);
  try {
    // Validate file type
    state.setStatus(`PROCESSFILE: Validating file type for: ${file.name}`);
    if (!file.name.endsWith(".json")) {
      state.setStatus("ERROR: Please select a JSON configuration file", true);
      return;
    }

    state.setStatus("PROCESSFILE: File type valid - creating FileReader...");
    const reader = new FileReader();

    // Add error handlers for FileReader
    reader.onerror = function () {
      state.setStatus("ERROR: Failed to read file - file might be corrupted", true);
    };

    reader.onabort = function () {
      state.setStatus("ERROR: File reading was aborted", true);
    };

    reader.onload = async function (e) {
      try {
        state.setStatus("PROCESSFILE: FileReader onload triggered - parsing JSON...");
        const configData = JSON.parse(e.target.result);
        state.setStatus("PROCESSFILE: JSON parsed successfully - calling loadConfigData...");
        await loadConfigData(configData, file.name);
      } catch (error) {
        state.setStatus(`ERROR: Invalid JSON file - ${error.message}`, true);
      }
    };

    state.setStatus("PROCESSFILE: Calling reader.readAsText() to start reading...");
    reader.readAsText(file);
  } catch (error) {
    state.setStatus(`ERROR: File processing failed - ${error.message}`, true);
  }
}

// Load config data (simplified with better success path handling)
async function loadConfigData(configData, fileName) {
  state.setStatus("ENTRY: loadConfigData() called - starting processing...");
  try {
    // Validate config structure
    state.setStatus("STEP 1: Validating config structure...");
    if (!configData?.["excel-projects"]) {
      throw new Error("Invalid config format - missing excel-projects structure");
    }

    state.setStatus("STEP 2: Config structure valid - setting raw config...");
    state.set("config.raw", configData);
    
    state.setStatus("STEP 3: Getting current Excel workbook name...");

    // Get workbook name with retry for Office 365 API resilience
    let workbook;
    let excelRetryCount = 0;
    const maxExcelRetries = 3;
    const excelRetryDelay = 300; // ms
    
    while (!workbook && excelRetryCount < maxExcelRetries) {
      try {
        state.setStatus(`STEP 4: Calling Excel.run() to get workbook name (attempt ${excelRetryCount + 1}/${maxExcelRetries})...`);
        workbook = await Excel.run(async (context) => {
          const wb = context.workbook;
          wb.load("name");
          await context.sync();
          return wb.name;
        });
        state.setStatus(`STEP 5: Got workbook name: "${workbook}" - looking for matching config...`);
      } catch (excelError) {
        excelRetryCount++;
        state.setStatus(`LOG: Excel.run() attempt ${excelRetryCount} failed: ${excelError.message}`);
        
        if (excelRetryCount >= maxExcelRetries) {
          state.setStatus(`ERROR: Excel.run() failed after ${maxExcelRetries} attempts: ${excelError.message}`, true);
          throw new Error(`Failed to get Excel workbook name after ${maxExcelRetries} attempts: ${excelError.message}`);
        } else {
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, excelRetryDelay));
        }
      }
    }

    // Find matching config
    state.setStatus("STEP 6: Searching for matching config...");
    const config = configData["excel-projects"][workbook] || configData["excel-projects"]["*"];
    
    const availableWorkbooks = Object.keys(configData["excel-projects"]).join(", ");
    state.setStatus(`STEP 7: Available configs: ${availableWorkbooks}`);
    
    if (!config?.standard_mappings?.length) {
      state.setStatus(`STEP 7-ERROR: No config found for "${workbook}"`, true);
      throw new Error(`3No valid configuration found for workbook: "${workbook}". Available: ${availableWorkbooks}`);
    }

    state.setStatus(`STEP 8: Config found! Has ${config.standard_mappings.length} mappings - applying settings...`);
    state.setConfig({ ...config, workbook });
    
    // Verify UI container exists before proceeding
    const container = document.getElementById("mapping-configs-container");
    if (!container) {
      state.setStatus("ERROR: UI not ready - switching to setup view...", true);
      // Try to switch to setup view to show the container
      if (window.showView) {
        window.showView("setup");
        // Wait a moment and try again
        await new Promise(resolve => setTimeout(resolve, 100));
        const retryContainer = document.getElementById("mapping-configs-container");
        if (!retryContainer) {
          throw new Error("Configuration UI container not available - please refresh the add-in");
        }
      } else {
        throw new Error("Configuration UI not ready - please refresh the add-in");
      }
    }
    
    state.setStatus(`LOG: UI container verified - style display: ${container.style.display}, visibility: ${container.style.visibility}, offsetParent: ${!!container.offsetParent}`);

    // Reload mapping modules with enhanced validation
    state.setStatus("LOG: Starting mapping module reload...");
    
    if (!window.app) {
      throw new Error("Application not available - please refresh the add-in and try again");
    }
    
    if (!window.app.reloadMappingModules) {
      throw new Error("Mapping module functionality not available - please refresh the add-in");
    }
    
    try {
      await window.app.reloadMappingModules();
      
      // Get fresh reference to container after potential view switch
      const finalContainer = document.getElementById("mapping-configs-container");
      if (!finalContainer) {
        throw new Error("Container disappeared after module reload");
      }
      
      // Verify container state after reload
      const finalChildCount = finalContainer.children.length;
      
      state.setStatus(`LOG: Module reload completed - container children: ${finalChildCount}`);
      
      if (finalChildCount === 0) {
        throw new Error("Module reload completed but no UI elements were created - check configuration");
      }
      
      state.setStatus(`SUCCESS: Configuration loaded from ${fileName} - Found ${config.standard_mappings.length} standard mapping(s)`);
    } catch (moduleError) {
      state.setStatus(`ERROR: Module reload failed: ${moduleError.message}`, true);
      throw moduleError;
    }

  } catch (error) {
    state.setStatus(`FAILED: ${error.message}`, true);
    // Also try direct DOM update as backup
    const statusElement = document.getElementById("main-status-message");
    if (statusElement) {
      statusElement.textContent = `FAILED: ${error.message}`;
      statusElement.style.color = "#D83B01";
    }
  }
}

// Direct event binding without manager layers
function setupDirectEventBindings() {
  // Toggle metadata button
  document.addEventListener("click", (e) => {
    if (e.target.closest("#show-metadata-btn")) {
      e.preventDefault();
      const content = document.getElementById("metadata-content");
      const btn = e.target.closest("#show-metadata-btn");
      if (content && btn) {
        const isHidden = content.classList.toggle("hidden");
        const label = btn.querySelector(".ms-Button-label") || btn;
        label.textContent = isHidden ? "Show Processing Details" : "Hide Processing Details";
      }
    }

    // Start tracking button
    if (e.target.closest("#setup-map-tracking")) {
      e.preventDefault();
      if (window.app?.startTracking) {
        window.app.startTracking();
      }
    }

    // Renew prompt button
    if (e.target.closest("#renew-prompt")) {
      e.preventDefault();
      if (window.app?.renewPrompt) {
        window.app.renewPrompt();
      }
    }

    // Navigation tabs
    const tab = e.target.closest(".nav-tab");
    if (tab) {
      e.preventDefault();
      const viewName = tab.getAttribute("data-view");
      showView(viewName);
    }
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
