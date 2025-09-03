// Entry point
import { AppOrchestrator } from "../shared-services/app.orchestrator.js";
import { ActivityFeed } from "../ui-components/ActivityFeedUI.js";
import { ServerConfig } from "../utils/serverConfig.js";
import { state } from "../shared-services/state.manager.js";

// Simple theme system
const theme = localStorage.getItem('theme') || 'default';

// Function to update content margin based on status bar height
function updateContentMargin() {
  const statusBar = document.querySelector('.status-bar');
  if (statusBar) {
    const statusBarHeight = statusBar.offsetHeight;
    document.documentElement.style.setProperty('--status-bar-height', `${statusBarHeight}px`);
  }
}

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) {
    document.getElementById("sideload-msg").textContent = "This add-in requires Microsoft Excel";
    return;
  }

  // Apply theme
  document.body.className = `ms-font-m ms-welcome ms-Fabric theme-${theme}`;

  ActivityFeed.init();

  // Hide loading, show app
  document.getElementById("sideload-msg").style.display = "none";
  document.getElementById("app-body").style.display = "flex";

  // Set up theme selector
  const themeSelector = document.getElementById('theme-selector');
  if (themeSelector) {
    themeSelector.value = theme;
    themeSelector.onchange = (e) => {
      localStorage.setItem('theme', e.target.value);
      location.reload();
    };
  }

  // Set up direct event bindings  
  setupDirectEventBindings();

  // Initialize server status
  initializeServerStatus();

  try {
    const app = new AppOrchestrator();
    await app.init();
    window.app = app; // For debugging
    window.showView = showView; // Make showView globally available
    
    // Add debug functions for testing
    window.testStatus = (message, isError = false) => {
      console.log("Testing status system:", message);
      state.setStatus(message, isError);
    };
    
    window.testLoadConfig = async () => {
      console.log("Testing config load with fake file...");
      const fakeFile = new File(['{"excel-projects": {"*": {"standard_mappings": []}}}'], 'test.json', {type: 'application/json'});
      await loadConfigFromFile(fakeFile);
    };

    // Detect Excel environment (Desktop vs Online)
    window.isExcelOnline = Office.context.platform === Office.PlatformType.OfficeOnline;
    console.log("Excel environment:", window.isExcelOnline ? "Online" : "Desktop");

    // Set up config drag/drop AFTER app is fully initialized
    setupConfigDropZone();

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
    const statusMessage = document.getElementById('main-status-message');
    if (statusMessage) {
      observer.observe(statusMessage, { 
        childList: true, 
        subtree: true, 
        characterData: true 
      });
    }
    
    // Update margin on window resize
    window.addEventListener('resize', updateContentMargin);
    
  } catch (error) {
    console.error("Failed to initialize:", error);
    alert(`Initialization failed: ${error.message}`);
  }
});

// Config drag/drop functionality
function setupConfigDropZone() {
  console.log("Setting up config drop zone...");
  const dropZone = document.getElementById("config-drop-zone");
  if (!dropZone) {
    console.error("Drop zone element 'config-drop-zone' not found!");
    return;
  }
  
  console.log("Drop zone element found, setting up event listeners...");

  // Prevent default behaviors
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => { 
      console.log(`Drop zone event: ${eventName}`);
      e.preventDefault(); 
      e.stopPropagation(); 
    }, false);
    document.body.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
  });

  // Visual feedback
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
      console.log(`Adding drag-over class on ${eventName}`);
      dropZone.classList.add("drag-over");
    }, false);
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => {
      console.log(`Removing drag-over class on ${eventName}`);
      dropZone.classList.remove("drag-over");
    }, false);
  });

  // Handle file drop
  dropZone.addEventListener("drop", async (e) => {
    console.log("File drop event triggered!");
    try {
      console.log("DataTransfer object:", e.dataTransfer);
      console.log("Files length:", e.dataTransfer.files.length);
      
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        console.log("Dropped file:", file.name, "Size:", file.size, "Type:", file.type);
        
        if (file.name.endsWith(".json")) {
          console.log("JSON file detected, loading...");
          await loadConfigFromFile(file);
        } else {
          console.log("Non-JSON file dropped");
          state.setStatus("Please drop a JSON configuration file", true);
        }
      } else {
        console.log("No files in drop event");
        state.setStatus("No file detected in drop", true);
      }
    } catch (error) {
      console.error("Error in drop handler:", error);
      state.setStatus(`Drop error: ${error.message}`, true);
    }
  });

  // Handle click to open file dialog  
  dropZone.addEventListener("click", () => {
    console.log("Drop zone clicked, opening file dialog...");
    console.log("Excel environment:", window.isExcelOnline ? "Online" : "Desktop");
    
    if (window.isExcelOnline) {
      // Use Office.js Dialog API for Excel Online
      openConfigDialog();
    } else {
      // Use direct FileReader for Desktop Excel
      openDirectFileDialog();
    }
  });
  
  console.log("Config drop zone setup completed!");
}

// Office.js Dialog API approach for Excel Online
function openConfigDialog() {
  console.log("Opening Office.js Dialog for file upload...");
  state.setStatus("Opening file upload dialog...");
  
  const dialogUrl = `${window.location.origin}/dialogs/config-upload.html`;
  console.log("Dialog URL:", dialogUrl);
  
  Office.context.ui.displayDialogAsync(
    dialogUrl,
    { height: 60, width: 50 },
    (result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        console.log("Dialog opened successfully");
        const dialog = result.value;
        
        // Handle messages from dialog
        dialog.addEventHandler(Office.EventType.DialogMessageReceived, (args) => {
          console.log("Message received from dialog:", args.message);
          
          try {
            const response = JSON.parse(args.message);
            
            if (response.success) {
              console.log("Config data received from dialog");
              state.setStatus(`Processing ${response.fileName}...`);
              processConfigDataFromDialog(response.configData, response.fileName);
            } else {
              console.error("Dialog reported error:", response.error);
              state.setStatus(response.error, true);
            }
            
            // Close dialog
            dialog.close();
            
          } catch (error) {
            console.error("Error parsing dialog message:", error);
            state.setStatus("Error processing file upload", true);
            dialog.close();
          }
        });
        
        // Handle dialog events
        dialog.addEventHandler(Office.EventType.DialogEventReceived, (args) => {
          console.log("Dialog event:", args.error);
          if (args.error === 12006) { // Dialog closed by user
            state.setStatus("File upload cancelled");
          } else {
            state.setStatus("Dialog error occurred", true);
          }
        });
        
      } else {
        console.error("Failed to open dialog:", result.error);
        state.setStatus("Failed to open file upload dialog", true);
      }
    }
  );
}

// Direct FileReader approach for Desktop Excel
function openDirectFileDialog() {
  console.log("Using direct file input for Desktop Excel...");
  state.setStatus("Opening file dialog...");
  
  try {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    
    input.onchange = async (e) => {
      console.log("File input onchange event fired!");
      const file = e.target.files[0];
      
      if (file) {
        console.log("File selected via dialog:", file.name);
        state.setStatus(`Processing ${file.name}...`);
        await loadConfigFromFile(file);
      } else {
        console.log("No file selected");
        state.setStatus("No file selected", true);
      }
    };
    
    input.click();
    console.log("File dialog triggered");
    
  } catch (error) {
    console.error("Error opening file dialog:", error);
    state.setStatus(`File dialog error: ${error.message}`, true);
  }
}

// Process config data received from dialog
async function processConfigDataFromDialog(configData, fileName) {
  console.log("=== Processing config data from dialog ===");
  console.log("Config data:", configData);
  console.log("File name:", fileName);
  
  try {
    // Store raw config data (same as loadConfigFromFile)
    console.log("Storing raw config data in state...");
    state.set("config.raw", configData);
    console.log("Raw config stored");
    
    // Check app availability
    if (!window.app) {
      throw new Error("App not initialized - please try again in a moment");
    }
    console.log("App is available, proceeding with reload...");

    // Reload mapping modules if available
    if (window.app.reloadMappingModules) {
      try {
        console.log("Reloading mapping modules...");
        await window.app.reloadMappingModules();
        console.log("Mapping modules reloaded successfully");
      } catch (moduleError) {
        console.warn("Mapping modules reload failed (continuing):", moduleError.message);
      }
    }

    // Trigger proper config reload
    if (window.app.reloadConfig) {
      console.log("Triggering config reload...");
      await window.app.reloadConfig();
      console.log("Config reload completed successfully");
      // reloadConfig() handles the success status message
    } else {
      console.log("No reloadConfig method available, showing basic success message");
      state.setStatus(`Configuration loaded from ${fileName}`);
    }
    
    console.log("=== Config processing completed successfully ===");
    
  } catch (error) {
    console.error("=== Config processing failed ===");
    console.error("Error details:", error);
    
    let errorMessage = `Failed to process config: ${error.message}`;
    
    // Add helpful context for common issues
    if (error.message.includes("App not initialized")) {
      errorMessage += "\n\nTip: Wait a moment for the add-in to fully load, then try again.";
    }
    
    if (error.message.includes("No valid configuration found")) {
      errorMessage += "\n\nCheck that your workbook name matches a key in the config file.";
    }
    
    state.setStatus(errorMessage, true);
  }
}

// Load config from dropped/selected file
async function loadConfigFromFile(file) {
  console.log("=== Starting loadConfigFromFile ===");
  console.log("File:", file.name, "Size:", file.size);
  console.log("window.app available:", !!window.app);
  
  try {
    state.setStatus("Loading configuration file...");
    
    // Step 1: Read and parse file
    console.log("Reading file content...");
    const text = await file.text();
    console.log("File content length:", text.length);
    
    console.log("Parsing JSON...");
    const configData = JSON.parse(text);
    console.log("Config data parsed successfully");
    
    // Step 2: Validate structure
    if (!configData?.["excel-projects"]) {
      throw new Error("Invalid config format - missing excel-projects structure");
    }
    console.log("Config structure validated");

    // Step 3: Store raw config data
    console.log("Storing raw config data in state...");
    state.set("config.raw", configData);
    console.log("Raw config stored");
    
    // Step 4: Check app availability
    if (!window.app) {
      throw new Error("App not initialized - please try again in a moment");
    }
    console.log("App is available, proceeding with reload...");

    // Step 5: Reload mapping modules if available
    if (window.app.reloadMappingModules) {
      try {
        console.log("Reloading mapping modules...");
        await window.app.reloadMappingModules();
        console.log("Mapping modules reloaded successfully");
      } catch (moduleError) {
        console.warn("Mapping modules reload failed (continuing):", moduleError.message);
        // Don't fail the whole process for this
      }
    } else {
      console.log("No reloadMappingModules method available");
    }

    // Step 6: Trigger proper config reload
    if (window.app.reloadConfig) {
      console.log("Triggering config reload...");
      await window.app.reloadConfig();
      console.log("Config reload completed successfully");
      // reloadConfig() handles the success status message
    } else {
      console.log("No reloadConfig method available, showing basic success message");
      state.setStatus(`Configuration loaded from ${file.name}`);
    }
    
    console.log("=== loadConfigFromFile completed successfully ===");
  } catch (error) {
    console.error("=== Config load failed ===");
    console.error("Error details:", error);
    console.error("Error stack:", error.stack);
    
    let errorMessage = `Failed to load config: ${error.message}`;
    
    // Add helpful context for common cloud issues
    if (error.message.includes("App not initialized")) {
      errorMessage += "\n\nTip: Wait a moment for the add-in to fully load, then try again.";
    }
    
    if (error.message.includes("No valid configuration found")) {
      errorMessage += "\n\nCheck that your workbook name matches a key in the config file.";
    }
    
    state.setStatus(errorMessage, true);
  }
}

// Direct event binding without manager layers
function setupDirectEventBindings() {
  // Toggle metadata button
  document.addEventListener('click', (e) => {
    if (e.target.closest('#show-metadata-btn')) {
      e.preventDefault();
      const content = document.getElementById("metadata-content");
      const btn = e.target.closest('#show-metadata-btn');
      if (content && btn) {
        const isHidden = content.classList.toggle("hidden");
        const label = btn.querySelector(".ms-Button-label") || btn;
        label.textContent = isHidden ? "Show Processing Details" : "Hide Processing Details";
      }
    }
    
    // Start tracking button
    if (e.target.closest('#setup-map-tracking')) {
      e.preventDefault();
      if (window.app?.startTracking) {
        window.app.startTracking();
      }
    }
    
    // Renew prompt button  
    if (e.target.closest('#renew-prompt')) {
      e.preventDefault();
      if (window.app?.renewPrompt) {
        window.app.renewPrompt();
      }
    }

    // Navigation tabs
    const tab = e.target.closest('.nav-tab');
    if (tab) {
      e.preventDefault();
      const viewName = tab.getAttribute('data-view');
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
  views.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.classList.toggle("hidden", !id.startsWith(viewName));
    }
  });

  // Update tab states
  document.querySelectorAll('.nav-tab').forEach(tab => {
    const isActive = tab.getAttribute('data-view') === viewName;
    tab.classList.toggle('ms-Button--primary', isActive);
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
  document.addEventListener('click', (e) => {
    if (e.target.closest('#server-status-led')) {
      e.preventDefault();
      checkServerStatus();
    }
  });

  // API key input
  const apiKeyInput = document.getElementById('api-key-input');
  if (apiKeyInput) {
    apiKeyInput.addEventListener('input', (e) => {
      state.set("server.apiKey", e.target.value.trim());
    });
  }

  // Server URL input  
  const serverUrlInput = document.getElementById('server-url-input');
  if (serverUrlInput) {
    serverUrlInput.addEventListener('input', (e) => {
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
  
  const tooltipText = isOnline && serverInfo.connectionType && serverInfo.connectionUrl
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
