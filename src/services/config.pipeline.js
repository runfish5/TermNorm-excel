// Configuration pipeline - handles the complete config loading flow with proper error handling
import { state, setStatus, setConfig } from "../shared-services/state.manager.js";
import { getCurrentWorkbookName } from "../utils/app-utilities.js";
import { showView } from "../ui-components/view-manager.js";
import { columnMappingService } from "./column-mapping.service.js";

class ConfigPipeline {
  constructor() {
    this.steps = [
      { name: "loadRawConfig", fn: this.loadRawConfig },
      { name: "validateStructure", fn: this.validateStructure },
      { name: "selectWorkbookConfig", fn: this.selectWorkbookConfig },
      { name: "validateMappings", fn: this.validateMappings },
      { name: "setupUI", fn: this.setupUI },
      { name: "initializeModules", fn: this.initializeModules }
    ];
  }

  async processConfig(configData = null) {
    const context = { configData, workbook: null, selectedConfig: null };
    
    try {
      for (const step of this.steps) {
        setStatus(`Processing: ${step.name}...`);
        await step.fn.call(this, context);
      }
      
      setStatus(`Config loaded - Found ${context.selectedConfig.standard_mappings.length} standard mapping(s)`);
      return context.selectedConfig;
      
    } catch (error) {
      const errorMessage = this.buildErrorMessage(error, context);
      setStatus(errorMessage, true);
      throw error;
    }
  }

  async loadRawConfig(context) {
    if (context.configData) {
      state.config.raw = context.configData;
      return;
    }

    if (!state.config.raw) {
      context.configData = (await import("../../config/app.config.json")).default;
      state.config.raw = context.configData;
    } else {
      context.configData = state.config.raw;
    }
  }

  async validateStructure(context) {
    if (!context.configData?.["excel-projects"]) {
      throw new Error("Invalid config format - missing excel-projects structure");
    }
  }

  async selectWorkbookConfig(context) {
    context.workbook = await getCurrentWorkbookName();
    const projects = context.configData["excel-projects"];
    context.selectedConfig = projects[context.workbook] || projects["*"];

    if (!context.selectedConfig) {
      const available = Object.keys(projects).join(", ");
      throw new Error(`No valid configuration found for workbook: "${context.workbook}". Available: ${available}`);
    }

    // Add workbook name to config
    context.selectedConfig = { ...context.selectedConfig, workbook: context.workbook };
  }

  async validateMappings(context) {
    if (!context.selectedConfig.standard_mappings?.length) {
      throw new Error("Configuration must have at least one standard mapping");
    }

    if (!context.selectedConfig.column_map || Object.keys(context.selectedConfig.column_map).length === 0) {
      throw new Error("Configuration must have column_map defined");
    }
  }

  async setupUI(context) {
    showView("setup");
    
    // Brief delay to ensure DOM is ready
    await new Promise((resolve) => setTimeout(resolve, 50));

    const container = document.getElementById("mapping-configs-container");
    if (!container) {
      throw new Error("Configuration UI container not available - please refresh the add-in");
    }
  }

  async initializeModules(context) {
    // Set the config in global state
    setConfig(context.selectedConfig);
    
    // Clear any cached column mappings for this workbook
    columnMappingService.clearCache(context.workbook);
    
    // Initialize global modules array
    window.mappingModules = window.mappingModules || [];
    
    // Import and call the module reloader
    const { reloadMappingModules } = await import("../ui-components/file-handling.js");
    await reloadMappingModules();
  }

  buildErrorMessage(error, context) {
    let message = `Config failed: ${error.message}`;

    if (error.message.includes("No valid configuration found for workbook:")) {
      const keys = Object.keys(context.configData?.["excel-projects"] || {});
      if (keys.length) {
        message += `\n\nAvailable keys: [${keys.join(", ")}] or add "*" as fallback`;
      }
    }

    return message;
  }

  async loadStaticConfig() {
    return this.processConfig();
  }

  async loadFromFile(configData, fileName) {
    try {
      const config = await this.processConfig(configData);
      setStatus(`Configuration loaded from ${fileName} - Found ${config.standard_mappings.length} standard mapping(s)`);
      return config;
    } catch (error) {
      setStatus(error.message, true);
      throw error;
    }
  }
}

// Export singleton instance
export const configPipeline = new ConfigPipeline();