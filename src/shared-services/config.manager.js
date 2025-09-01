// shared-services/config.manager.js
import { state } from "./state.manager.js";

export class ConfigManager {
  constructor() {
    // Stateless - all config stored in StateManager
  }

  async loadConfig() {
    try {
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

      return enhancedConfig;
    } catch (error) {
      console.error("Config load failed:", error);
      throw error;
    }
  }

  getConfig() {
    return state.get("config.data");
  }

  // Get all standard mappings
  getStandardMappings() {
    const config = this.getConfig();
    return config?.standard_mappings || [];
  }

  // Set config data (used by drag-and-drop)
  setConfig(configData) {
    state.set("config.raw", configData);
  }

  // Get excel-projects info for error messages
  getExcelProjectsInfo() {
    const currentConfigData = state.get("config.raw");
    const excelProjects = currentConfigData?.["excel-projects"];
    return excelProjects
      ? {
          count: Object.keys(excelProjects).length,
          keys: Object.keys(excelProjects),
        }
      : { count: 0, keys: [] };
  }
}
