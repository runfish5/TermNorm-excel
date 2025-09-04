// shared-services/app.orchestrator.js
import { LiveTracker } from "../services/live.tracker.js";
import { aiPromptRenewer } from "../services/aiPromptRenewer.js";
import { MappingConfigModule } from "../ui-components/mapping-config-module.js";
import { state } from "./state.manager.js";

export class AppOrchestrator {
  constructor() {
    this.tracker = new LiveTracker();
    this.aiPromptRenewer = new aiPromptRenewer((msg, isError) => state.setStatus(msg, isError));
    this.configLoaded = false;
    this.mappingModules = [];
    this.isOffice365 = this._detectOffice365();

    // Add this line for easy debugging
    window.state = state;

    // Ensure this instance stays available in Office 365
    if (this.isOffice365) {
      this._enhanceOffice365Stability();
    }
  }

  _detectOffice365() {
    return (
      typeof window !== "undefined" &&
      (window.location.hostname.includes("excel.officeapps.live.com") ||
        window.location.hostname.includes("office.com") ||
        window.location.hostname.includes("officeapps-df.live.com") ||
        Office.context?.host?.includes("ExcelWebApp") ||
        Office.context?.platform === Office.PlatformType.OfficeOnline)
    );
  }

  _enhanceOffice365Stability() {
    // Prevent garbage collection in Office 365 by keeping strong references
    if (!window._termnormAppInstances) {
      window._termnormAppInstances = [];
    }
    window._termnormAppInstances.push(this);

    // Add periodic availability check for Office 365
    this._office365HealthCheck = setInterval(() => {
      if (window.app !== this) {
        console.warn("TermNorm: window.app reference lost in Office 365, restoring...");
        window.app = this;
      }
    }, 5000);
  }

  async init() {
    await this.reloadConfig();
    this.configLoaded = true;
  }

  async reloadConfig() {
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
        throw new Error(`1No valid configuration found for workbook: ${workbook}`);
      }

      state.setConfig({ ...config, workbook });
      if (!this.configLoaded) await this.reloadMappingModules();

      state.setStatus(`Config reloaded - Found ${config.standard_mappings.length} standard mapping(s)`);
    } catch (error) {
      let errorMessage = `Config failed: ${error.message}`;
      if (error.message.includes("2No valid configuration found for workbook:")) {
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

  async startTracking() {
    const config = state.get("config.data");
    if (!config?.column_map || !Object.keys(config.column_map).length) {
      return state.setStatus("Error: Load config first", true);
    }

    state.combineMappingSources();
    const mappings = state.get("mappings");
    
    const hasForward = mappings.forward && Object.keys(mappings.forward).length > 0;
    const hasReverse = mappings.reverse && Object.keys(mappings.reverse).length > 0;
    if (!hasForward && !hasReverse) {
      return state.setStatus("Error: Load mappings first", true);
    }

    try {
      await this.tracker.start(config, mappings);

      const forwardCount = Object.keys(mappings.forward || {}).length;
      const reverseCount = Object.keys(mappings.reverse || {}).length;
      const sourcesCount = mappings.metadata?.sources?.length || 0;

      const mode = forwardCount > 0 ? "with mappings" : "reverse-only";
      const suffix = sourcesCount > 1 ? ` (${sourcesCount} sources)` : "";
      
      state.setStatus(`Tracking active ${mode}${suffix} - ${forwardCount} forward, ${reverseCount} reverse`);
      // Show results view - will be handled by taskpane.js showView function
      if (window.showView) {
        window.showView("results");
      }
    } catch (error) {
      state.setStatus(`Error: ${error.message}`, true);
    }
  }

  async renewPrompt() {
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
      button.removeEventListener("click", this.renewPrompt);
      button.addEventListener("click", cancelHandler);
    }
    if (label) label.textContent = "Cancel Generation";

    try {
      const mappings = state.get("mappings");
      await this.aiPromptRenewer.renewPrompt(mappings, config, () => cancelled);
    } finally {
      if (button) {
        button.removeEventListener("click", cancelHandler);
        button.addEventListener("click", () => this.renewPrompt());
      }
      if (label) label.textContent = originalText;
    }
  }

  async reloadMappingModules() {
    const config = state.get("config.data");
    const standardMappings = config?.standard_mappings || [];

    state.setStatus(`LOG: reloadMappingModules() started - checking config...`);
    if (!standardMappings?.length) {
      state.setStatus("LOG: No standard mappings found - skipping module reload");
      return;
    }

    state.setStatus(`LOG: Found ${standardMappings.length} mappings - looking for container...`);
    const container = document.getElementById("mapping-configs-container");
    if (!container) {
      state.setStatus("LOG: ERROR - mapping-configs-container element not found in DOM", true);
      throw new Error("Mapping configs container not found");
    }

    const beforeChildCount = container.children.length;
    state.setStatus(`LOG: Container found - children before clear: ${beforeChildCount}`);
    
    // Reset state
    container.innerHTML = "";
    this.mappingModules = [];
    
    const afterClearCount = container.children.length;
    state.setStatus(`LOG: Container cleared - children after clear: ${afterClearCount}`);

    state.setStatus(`LOG: Starting creation of ${standardMappings.length} modules...`);
    
    // Create new modules
    this.mappingModules = standardMappings.map((config, index) => {
      state.setStatus(`LOG: Creating module ${index + 1} - ref: ${config.mapping_reference || 'Unknown'}`);
      
      const module = new MappingConfigModule(config, index, (moduleIndex, mappings, result) =>
        this.onMappingLoaded(moduleIndex, mappings, result)
      );
      
      const beforeInitCount = container.children.length;
      state.setStatus(`LOG: Before init() - container children: ${beforeInitCount}`);
      
      try {
        const initResult = module.init(container);
        const afterInitCount = container.children.length;
        state.setStatus(`LOG: Module ${index + 1} init() completed - children: ${beforeInitCount} -> ${afterInitCount}`);
        
        if (initResult && initResult.id) {
          state.setStatus(`LOG: Module ${index + 1} element created with ID: ${initResult.id}`);
        } else {
          state.setStatus(`LOG: Module ${index + 1} init() returned: ${typeof initResult}`);
        }
      } catch (initError) {
        state.setStatus(`LOG: ERROR - Module ${index + 1} init failed: ${initError.message}`, true);
      }
      
      return module;
    });

    const finalChildCount = container.children.length;
    state.setStatus(`LOG: All modules created - final container children: ${finalChildCount}`);
    
    // Log container HTML state for debugging
    const containerHTML = container.innerHTML.substring(0, 200);
    state.setStatus(`LOG: Container HTML preview: ${containerHTML}${container.innerHTML.length > 200 ? '...' : ''}`);

    this.updateGlobalStatus();
    state.setStatus(`LOG: Mapping modules reload completed - ${standardMappings.length} modules active`);
  }

  onMappingLoaded(moduleIndex, mappings, result) {
    // Mapping data is now managed directly in state - just update UI
    this.updateGlobalStatus();
    this.updateJsonDump();
  }

  updateJsonDump() {
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

  // Cleanup method for Office 365 health check
  destroy() {
    if (this._office365HealthCheck) {
      clearInterval(this._office365HealthCheck);
      this._office365HealthCheck = null;
    }

    // Remove from instances array
    if (window._termnormAppInstances) {
      const index = window._termnormAppInstances.indexOf(this);
      if (index > -1) {
        window._termnormAppInstances.splice(index, 1);
      }
    }
  }
}
