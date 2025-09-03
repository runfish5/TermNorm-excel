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

  // Set up config drag/drop
  setupConfigDropZone();

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
  const dropZone = document.getElementById("config-drop-zone");
  if (!dropZone) return;

  // Prevent default behaviors
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    document.body.addEventListener(eventName, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
  });

  // Visual feedback
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add("drag-over"), false);
  });
  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove("drag-over"), false);
  });

  // Handle file drop
  dropZone.addEventListener("drop", async (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith(".json")) {
        await loadConfigFromFile(file);
      } else {
        state.setStatus("Please drop a JSON configuration file", true);
      }
    }
  });

  // Handle click to open file dialog  
  dropZone.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) await loadConfigFromFile(file);
    };
    input.click();
  });
}

// Load config from dropped/selected file
async function loadConfigFromFile(file) {
  try {
    console.log("Loading config from:", file.name);
    state.setStatus("Loading configuration file...");
    
    const text = await file.text();
    const configData = JSON.parse(text);
    
    if (!configData?.["excel-projects"]) {
      throw new Error("Invalid config format - missing excel-projects structure");
    }

    // Store raw config data (like the working ConfigManager.setConfig)
    state.set("config.raw", configData);
    
    // Reload mapping modules if orchestrator is available
    if (window.app?.reloadMappingModules) {
      try {
        await window.app.reloadMappingModules();
      } catch (moduleError) {
        console.warn("Mapping modules reload failed (continuing):", moduleError.message);
      }
    }

    // Trigger proper config reload (like the working flow)
    if (window.app?.reloadConfig) {
      await window.app.reloadConfig();
      // reloadConfig() handles the success status message
    } else {
      state.setStatus(`Configuration loaded from ${file.name}`);
    }
  } catch (error) {
    console.error("Config load failed:", error);
    state.setStatus(`Failed to load config: ${error.message}`, true);
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
