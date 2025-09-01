// ui-components/ui.manager.js
import { MappingConfigModule } from "./mapping-config-module.js";
import { CandidateRankingUI } from "./CandidateRankingUI.js";
import { state } from "../shared-services/state.manager.js";

export class UIManager {
  constructor(orchestrator = null) {
    this.mappingModules = [];
    this.loadedMappings = new Map();
    this.orchestrator = orchestrator;
  }

  init() {
    this.setupEvents();
    this.setupDropZone();
    this.setupServerStatus();
    CandidateRankingUI.init();
    this.showView("config");
    state.subscribe("ui", (ui) => this.updateStatus(ui.statusMessage, ui.isError));
    state.subscribe("server", (server) => {
      this.updateServerLED(server.online, server.host);
      this.updateCloudIndicator(server.info);
    });
    return this;
  }

  setupEvents() {
    const events = {
      "show-metadata-btn": () => {
        const content = document.getElementById("metadata-content");
        const isHidden = content?.classList.toggle("hidden");
        const label = document.querySelector("#show-metadata-btn .ms-Button-label");
        if (label) label.textContent = isHidden ? "Show Processing Details" : "Hide Processing Details";
      },
      "setup-map-tracking": () => this.startTracking(),
      "activate-tracking": (e) => {
        e.preventDefault();
        this.showView("tracking");
        this.startTracking();
      },
    };

    Object.entries(events).forEach(([id, handler]) => document.getElementById(id)?.addEventListener("click", handler));
  }

  setupDropZone() {
    const dropZone = document.getElementById("config-drop-zone");
    if (!dropZone) return;

    // Prevent default drag behaviors
    ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, this.preventDefaults, false);
      document.body.addEventListener(eventName, this.preventDefaults, false);
    });

    // Highlight drop zone when item is dragged over it
    ["dragenter", "dragover"].forEach((eventName) => {
      dropZone.addEventListener(eventName, () => dropZone.classList.add("drag-over"), false);
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, () => dropZone.classList.remove("drag-over"), false);
    });

    // Handle dropped files
    dropZone.addEventListener("drop", (e) => this.handleDrop(e), false);

    // Handle click to open file dialog
    dropZone.addEventListener("click", () => this.openFileDialog(), false);
  }

  preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  async handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;

    if (files.length === 0) return;

    const file = files[0];
    if (!file.name.endsWith(".json")) {
      state.setStatus("Please drop a JSON configuration file", true);
      return;
    }

    await this.loadConfigFromFile(file);
  }

  openFileDialog() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this.loadConfigFromFile(file);
      }
    };
    input.click();
  }

  validateConfigStructure(configData) {
    if (!configData?.["excel-projects"]) {
      throw new Error("Invalid config format - missing excel-projects structure");
    }
  }

  async loadConfigFromFile(file) {
    try {
      console.log("Loading config from:", file.name);
      state.setStatus("Loading configuration file...");

      const text = await file.text();
      const configData = JSON.parse(text);
      this.validateConfigStructure(configData);

      this.orchestrator.configManager.setConfig(configData);

      try {
        await this.reloadMappingModules();
      } catch (moduleError) {
        console.warn("Mapping modules reload failed (continuing):", moduleError.message);
      }

      if (this.orchestrator) {
        await this.orchestrator.reloadConfig();
        // reloadConfig() handles the success status message
      } else {
        state.setStatus(`Configuration loaded from ${file.name}`);
      }
    } catch (error) {
      console.error("Config load failed:", error);
      state.setStatus(`Failed to load config: ${error.message}`, true);
    }
  }

  showView(viewName) {
    ["config-div", "tracking-view"].forEach((id) =>
      document.getElementById(id)?.classList.toggle("hidden", !id.startsWith(viewName))
    );
    ["load-config", "activate-tracking"].forEach((id) =>
      document.getElementById(id)?.classList.toggle("ms-Button--primary", id.includes(viewName))
    );
    state.setView(viewName);
  }

  async reloadMappingModules() {
    const standardMappings = this.orchestrator.configManager.getStandardMappings();

    if (!standardMappings?.length) {
      console.log("No standard mappings found - skipping module reload");
      return;
    }

    const container = document.getElementById("mapping-configs-container");
    if (!container) {
      throw new Error("Mapping configs container not found");
    }

    container.innerHTML = "";
    this.mappingModules = [];
    this.loadedMappings.clear();

    this.mappingModules = standardMappings.map((config, index) => {
      const module = new MappingConfigModule(config, index, (moduleIndex, mappings, result) =>
        this.onMappingLoaded(moduleIndex, mappings, result)
      );
      module.init(container);
      return module;
    });

    this.updateGlobalStatus();
    console.log(`Reloaded ${standardMappings.length} mapping modules`);
  }

  onMappingLoaded(moduleIndex, mappings, result) {
    this.loadedMappings.set(moduleIndex, { mappings, result });
    this.updateGlobalStatus();
    this.updateJsonDump();
  }

  // Minimal JSON dump functionality
  updateJsonDump() {
    const content = document.getElementById("metadata-content");
    if (!content || this.loadedMappings.size === 0) return;

    const data = Array.from(this.loadedMappings.entries()).map(([index, { mappings, result }]) => ({
      sourceIndex: index + 1,
      forwardMappings: Object.keys(mappings.forward).length,
      reverseMappings: Object.keys(mappings.reverse).length,
      metadata: result.metadata,
      mappings: mappings,
    }));

    content.innerHTML = `
            <div style="margin-top: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-family: monospace; font-size: 12px;">
                <strong>Raw Data:</strong>
                <pre style="margin: 5px 0; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(data, null, 2)}</pre>
            </div>`;
  }

  updateGlobalStatus() {
    const { size: loaded } = this.loadedMappings;
    const total = this.mappingModules.length;

    const message =
      loaded === 0
        ? "Ready to load mapping configurations..."
        : loaded === total
          ? `All ${total} mapping sources loaded`
          : `${loaded}/${total} mapping sources loaded`;

    state.setStatus(message);
  }

  async startTracking() {
    if (!this.orchestrator) {
      return state.setStatus("Error: No orchestrator available", true);
    }
    await this.orchestrator.startTracking();
  }

  updateStatus(message, isError = false) {
    const statusElement = document.getElementById("main-status-message");
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.style.color = isError ? "#D83B01" : "";
    }
  }

  setupServerStatus() {
    // Set initial server host from existing service configuration
    const backendUrl = this.orchestrator?.aiPromptRenewer?.backendUrl || "http://127.0.0.1:8000";
    state.set("server.host", backendUrl);

    // Set up LED click handler
    const led = document.getElementById("server-status-led");
    if (led) {
      led.addEventListener("click", () => this.checkServerStatus());
    }


    // Set up API key input handler
    const apiKeyInput = document.getElementById("api-key-input");
    if (apiKeyInput) {
      apiKeyInput.addEventListener("input", (e) => {
        state.set("server.apiKey", e.target.value.trim());
      });
    }

    // Initial status check
    this.checkServerStatus();
  }

  async checkServerStatus() {
    const host = state.get("server.host");
    if (!host) return;

    try {
      const apiKey = state.get("server.apiKey");
      const headers = { "Content-Type": "application/json" };
      if (apiKey) {
        headers["X-API-Key"] = apiKey;
      }

      // Test basic connection first
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

        // Test a protected endpoint to validate full functionality
        if (apiKey) {
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

      state.update({
        "server.online": isOnline,
        "server.host": host,
        "server.info": serverInfo,
        "server.validation": connectionValidation,
      });

      // Show specific error messages
      if (!isOnline) {
        state.setStatus("Server connection failed", true);
      } else if (apiKey && !connectionValidation.protected) {
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
    }
  }

  updateServerLED(isOnline, host) {
    const led = document.getElementById("server-status-led");
    if (!led) return;

    led.className = `status-led ${isOnline ? "online" : "offline"}`;

    const status = isOnline ? "Online" : "Offline";
    const serverInfo = state.get("server.info") || {};

    let tooltipText;
    if (isOnline && serverInfo.connectionType && serverInfo.connectionUrl) {
      tooltipText = `${serverInfo.connectionType}\n${serverInfo.connectionUrl}\nStatus: ${status}\nClick to refresh`;
    } else {
      tooltipText = `Server: ${host || "Unknown"}\nStatus: ${status}\nClick to refresh`;
    }

    led.title = tooltipText;
  }

  updateCloudIndicator(serverInfo) {
    const cloudIndicator = document.getElementById("cloud-indicator");
    if (!cloudIndicator) return;

    const isCloudAPI = serverInfo?.connectionType === "Cloud API";

    if (isCloudAPI) {
      cloudIndicator.classList.remove("hidden");
    } else {
      cloudIndicator.classList.add("hidden");
    }
  }

  // Public API
  getAllLoadedMappings() {
    return this.loadedMappings;
  }
  getMappingModules() {
    return this.mappingModules;
  }
}
