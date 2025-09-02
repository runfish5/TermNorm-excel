// shared-services/app.orchestrator.js
import { LiveTracker } from "../services/live.tracker.js";
import { aiPromptRenewer } from "../services/aiPromptRenewer.js";
import { UIManager } from "../ui-components/ui.manager.js";
import { state } from "./state.manager.js";

export class AppOrchestrator {
  constructor() {
    this.tracker = new LiveTracker();
    this.ui = new UIManager(this);
    this.aiPromptRenewer = new aiPromptRenewer((msg, isError) => state.setStatus(msg, isError));
    this.configLoaded = false;

    // Add this line for easy debugging
    window.state = state;
  }

  async init() {
    this.ui.init();
    this.setupEvents();
    await this.reloadConfig();
    this.configLoaded = true;
  }

  setupEvents() {
    // All button events are now handled by UIManager
    // UIManager will delegate back to orchestrator methods as needed
  }

  async reloadConfig() {
    try {
      // Direct config loading without ConfigManager
      const workbook = await Excel.run(async (context) => {
        const wb = context.workbook;
        wb.load("name");
        await context.sync();
        return wb.name;
      });

      // Try to load config file at runtime
      let currentConfigData = state.get("config.raw");
      if (!currentConfigData) {
        try {
          const configModule = await import("../../config/app.config.json");
          currentConfigData = configModule.default || configModule;
          state.set("config.raw", currentConfigData);
        } catch (importError) {
          // File doesn't exist or import failed - this is OK, drag-drop will be required
        }
      }

      if (!currentConfigData?.["excel-projects"]) {
        throw new Error("Configuration file not found - please drag and drop a config file");
      }

      const config = currentConfigData["excel-projects"][workbook] || currentConfigData["excel-projects"]["*"];

      if (
        !config?.standard_mappings ||
        !Array.isArray(config.standard_mappings) ||
        config.standard_mappings.length === 0
      ) {
        throw new Error(`No valid configuration found for workbook: ${workbook}`);
      }

      // Validate that all mappings have required fields
      for (let i = 0; i < config.standard_mappings.length; i++) {
        const mapping = config.standard_mappings[i];
        if (!mapping?.mapping_reference) {
          throw new Error(`Mapping ${i + 1} is missing mapping_reference`);
        }
      }

      const enhancedConfig = { ...config, workbook };
      state.setConfig(enhancedConfig);

      if (!this.configLoaded) await this.ui.reloadMappingModules();

      // Show confirmation with standard mappings count
      const standardMappings = config?.standard_mappings || [];
      state.setStatus(`Config reloaded - Found ${standardMappings.length} standard mapping(s)`);
    } catch (error) {
      console.error("Config reload failed:", error);

      // Enhanced error handling with specific key hints
      let errorMessage = `Config failed: ${error.message}`;

      // If the error mentions workbook not found, provide specific key hint
      if (error.message.includes("No valid configuration found for workbook:")) {
        const workbookMatch = error.message.match(/workbook: (.+)/);
        if (workbookMatch) {
          const workbookName = workbookMatch[1];
          const configData = state.get("config.raw");
          const excelProjects = configData?.["excel-projects"] || {};
          const keys = Object.keys(excelProjects);

          errorMessage += `\n\nLooking for key "${workbookName}" in "excel-projects" dictionary of app.config.json`;
          errorMessage += `\nFound ${keys.length} excel-project(s): [${keys.join(", ")}]`;
          errorMessage += `\nAlternatively, add a "*" key as fallback for any workbook`;
        }
      }

      // Add config location and help hints
      errorMessage += `\n\nConfig location:\nC:\\Users\\{YOURS}\\OfficeAddinApps\\TermNorm-excel\\config\\app.config.json`;
      errorMessage += `\n\nFor Help visit:\nhttps://github.com/runfish5/TermNorm-excel`;

      state.setStatus(errorMessage, true);
      throw error; // Re-throw to prevent success message override
    }
  }

  async startTracking() {
    const config = state.get("config.data");
    if (!config?.column_map || !Object.keys(config.column_map).length) {
      return state.setStatus("Error: Load config first", true);
    }

    // Combine all stored mapping sources using state manager
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

      let mode = hasForward ? "with mappings" : "reverse-only";
      if (sourcesCount > 1) mode += ` (${sourcesCount} sources)`;

      state.setStatus(`Tracking active ${mode} - ${forwardCount} forward, ${reverseCount} reverse`);
      this.ui.showView("results");
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
}
