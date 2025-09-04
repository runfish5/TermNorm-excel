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

    // Add this line for easy debugging
    window.state = state;
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

  // Validate current state and provide user feedback
  validateTrackingReadiness() {
    const config = state.get("config.data");
    const rawSources = state.get("mappings.sources");
    const sourceCount = rawSources ? Object.keys(rawSources).length : 0;

    console.log("🔵 VALIDATE_TRACKING: Checking readiness -", {
      hasConfig: !!config,
      hasColumnMap: !!config?.column_map,
      columnMapCount: config?.column_map ? Object.keys(config.column_map).length : 0,
      sourceCount: sourceCount,
    });

    const validation = {
      ready: false,
      issues: [],
      summary: "",
    };

    // Check config
    if (!config) {
      validation.issues.push("❌ No configuration loaded");
    } else if (!config.column_map || !Object.keys(config.column_map).length) {
      validation.issues.push("❌ Configuration missing column mappings");
    } else {
      validation.issues.push(`✅ Configuration loaded (${Object.keys(config.column_map).length} column mappings)`);
    }

    // Check mapping sources
    if (sourceCount === 0) {
      validation.issues.push("❌ No mapping tables loaded");
    } else {
      validation.issues.push(`✅ ${sourceCount} mapping table(s) loaded`);

      // Check if combined mappings exist (they should be auto-combined when sources are added)
      const mappings = state.get("mappings");
      const forwardCount = mappings?.forward ? Object.keys(mappings.forward).length : 0;
      const reverseCount = mappings?.reverse ? Object.keys(mappings.reverse).length : 0;

      if (forwardCount > 0 || reverseCount > 0) {
        validation.issues.push(`✅ Valid mappings found (${forwardCount} forward, ${reverseCount} reverse)`);
        validation.ready = true;
      } else {
        validation.issues.push("❌ Mapping tables contain no valid mappings");
      }
    }

    validation.summary = validation.issues.join(" • ");
    return validation;
  }

  async startTracking() {
    console.log("🔵 ACTIVATE_TRACKING: Starting activation process");

    // Step 1: Check config
    const config = state.get("config.data");
    console.log("🔵 ACTIVATE_TRACKING: Config check -", {
      configExists: !!config,
      hasColumnMap: !!config?.column_map,
      columnMapKeys: config?.column_map ? Object.keys(config.column_map) : [],
      workbook: config?.workbook,
    });

    if (!config?.column_map || !Object.keys(config.column_map).length) {
      console.log("🔴 ACTIVATE_TRACKING: FAILED - No valid config");
      const errorMsg = !config
        ? "No configuration loaded - please drag and drop a config file first"
        : "Configuration missing column mappings - check your config file";
      return state.setStatus(`Error: ${errorMsg}`, true);
    }

    // Step 2: Check mapping sources before combining
    const rawSources = state.get("mappings.sources");
    console.log("🔵 ACTIVATE_TRACKING: Raw mapping sources -", {
      sourcesExist: !!rawSources,
      sourceCount: rawSources ? Object.keys(rawSources).length : 0,
      sourceKeys: rawSources ? Object.keys(rawSources) : [],
    });

    state.combineMappingSources();
    const mappings = state.get("mappings");
    console.log("🔵 ACTIVATE_TRACKING: Combined mappings -", {
      mappingsExist: !!mappings,
      forwardCount: mappings?.forward ? Object.keys(mappings.forward).length : 0,
      reverseCount: mappings?.reverse ? Object.keys(mappings.reverse).length : 0,
      hasMetadata: !!mappings?.metadata,
    });

    const hasForward = mappings.forward && Object.keys(mappings.forward).length > 0;
    const hasReverse = mappings.reverse && Object.keys(mappings.reverse).length > 0;

    if (!hasForward && !hasReverse) {
      console.log("🔴 ACTIVATE_TRACKING: FAILED - No valid mappings after combination");
      console.log("🔴 ACTIVATE_TRACKING: Debug info -", {
        mappingsState: mappings,
        rawSourcesState: rawSources,
        configState: config,
      });

      const sourceCount = rawSources ? Object.keys(rawSources).length : 0;
      let errorMsg;
      if (sourceCount === 0) {
        errorMsg = "No mapping tables loaded - click 'Load Mapping Table' buttons first";
      } else {
        errorMsg = `${sourceCount} mapping source(s) loaded but no valid mappings found - check your mapping tables`;
      }
      return state.setStatus(`Error: ${errorMsg}`, true);
    }

    // Step 3: Start tracking
    console.log("🔵 ACTIVATE_TRACKING: Starting tracker with valid data");
    try {
      await this.tracker.start(config, mappings);

      const forwardCount = Object.keys(mappings.forward || {}).length;
      const reverseCount = Object.keys(mappings.reverse || {}).length;
      const sourcesCount = mappings.metadata?.sources?.length || 0;

      const mode = forwardCount > 0 ? "with mappings" : "reverse-only";
      const suffix = sourcesCount > 1 ? ` (${sourcesCount} sources)` : "";

      console.log("🟢 ACTIVATE_TRACKING: SUCCESS - Tracking started");
      state.setStatus(`Tracking active ${mode}${suffix} - ${forwardCount} forward, ${reverseCount} reverse`);

      // Show results view - will be handled by taskpane.js showView function
      if (window.showView) {
        window.showView("results");
      }
    } catch (error) {
      console.log("🔴 ACTIVATE_TRACKING: FAILED - Tracker start error:", error);
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

    if (!standardMappings?.length) {
      return;
    }

    const container = document.getElementById("mapping-configs-container");
    if (!container) {
      throw new Error("Mapping configs container not found");
    }

    // Reset state
    container.innerHTML = "";
    this.mappingModules = [];

    // Create new modules
    this.mappingModules = standardMappings.map((config, index) => {
      const module = new MappingConfigModule(config, index, () => this.onMappingLoaded());

      try {
        module.init(container);
      } catch (initError) {
        state.setStatus(`Module ${index + 1} init failed: ${initError.message}`, true);
      }

      return module;
    });

    this.updateGlobalStatus();
  }

  onMappingLoaded() {
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
}
