// ui-components/ui.manager.js
import { MappingConfigModule } from "./mapping-config-module.js";
import { CandidateRankingUI } from "./CandidateRankingUI.js";
import { NavigationManager } from "./navigation.manager.js";
import { ThemeManager } from "./theme.manager.js";
import { ServerStatusManager } from "./server-status.manager.js";
import { HistoryManager } from "./history.manager.js";
import { domUtils } from "./dom.utils.js";
import { state } from "../shared-services/state.manager.js";

export class UIManager {
  constructor(orchestrator = null) {
    this.mappingModules = [];
    this.orchestrator = orchestrator;

    // Initialize specialized managers
    this.navigation = new NavigationManager();
    this.theme = new ThemeManager();
    this.serverStatus = new ServerStatusManager(orchestrator);
    this.history = new HistoryManager();
  }

  init() {
    // Initialize all managers
    this.navigation.init();
    this.theme.init();
    this.serverStatus.init();
    this.history.init();

    // Initialize UI components
    this.setupDropZone();
    CandidateRankingUI.init();

    // Set up remaining events
    this.setupEvents();

    // Subscribe to UI state changes
    state.subscribe("ui", (ui) => this.updateStatus(ui.statusMessage, ui.isError));

    return this;
  }

  setupEvents() {
    // Direct event binding for specific actions
    this.bindDirectHandler('#show-metadata-btn', () => this.toggleMetadata());
    this.bindDirectHandler('#setup-map-tracking', () => this.startMappingTracking());
    this.bindDirectHandler('#renew-prompt', () => this.renewPrompt());
  }

  bindDirectHandler(selector, handler) {
    const element = document.querySelector(selector);
    if (element) {
      element.addEventListener('click', (e) => {
        e.preventDefault();
        handler(element);
      });
    }
  }

  startMappingTracking() {
    this.navigation.showView("results");
    this.startTracking();
  }

  renewPrompt() {
    if (this.orchestrator) {
      this.orchestrator.renewPrompt();
    } else {
      console.warn('No orchestrator available for renewPrompt');
    }
  }

  toggleMetadata(button = null) {
    // Use button from parameter or find it directly
    const btn = button || document.getElementById('show-metadata-btn');
    const isHidden = domUtils.toggleElementVisibility("metadata-content");
    
    if (btn) {
      const label = btn.querySelector(".ms-Button-label");
      const newText = isHidden ? "Show Processing Details" : "Hide Processing Details";
      
      if (label) {
        label.textContent = newText;
      } else {
        btn.textContent = newText;
      }
    }
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

      // Direct state access instead of configManager chain
      state.setConfig(configData);

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

  // Delegate to navigation manager
  showView(viewName) {
    this.navigation.showView(viewName);
  }

  async reloadMappingModules() {
    const config = state.get("config.data");
    const standardMappings = config?.standard_mappings || [];

    if (!standardMappings?.length) {
      console.log("No standard mappings found - skipping module reload");
      return;
    }

    const container = domUtils.getElement("mapping-configs-container");
    if (!container) {
      throw new Error("Mapping configs container not found");
    }

    // Reset state
    container.innerHTML = "";
    this.mappingModules = [];

    // Create new modules
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
    this.updateGlobalStatus();
    this.updateJsonDump();
  }

  updateJsonDump() {
    const content = domUtils.getElement("metadata-content");
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

  updateGlobalStatus() {
    const sources = state.get("mappings.sources") || {};
    const loaded = Object.keys(sources).length;
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
    const statusElement = domUtils.getElement("main-status-message");
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.style.color = isError ? "#D83B01" : "";
    }
  }

  // Note: getAllLoadedMappings() and getMappingModules() removed
  // Mapping data is now managed directly in state manager
}
