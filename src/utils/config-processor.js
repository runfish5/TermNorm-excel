// utils/config-processor.js
// Pure functions for configuration validation and processing

// Validate config structure and return normalized data
export function validateConfigStructure(configData) {
  if (!configData?.["excel-projects"]) {
    throw new Error("Invalid config format - missing excel-projects structure");
  }
  return configData;
}

// Select workbook-specific config with fallback to "*"
export function selectWorkbookConfig(configData, workbook) {
  const projects = configData["excel-projects"];
  const config = projects[workbook] || projects["*"];
  
  if (!config?.standard_mappings?.length) {
    const available = Object.keys(projects).join(", ");
    throw new Error(`No valid configuration found for workbook: "${workbook}". Available: ${available}`);
  }
  
  return { ...config, workbook };
}

// Build detailed error message with available keys
export function buildConfigErrorMessage(error, configData) {
  let message = `Config failed: ${error.message}`;
  
  if (error.message.includes("No valid configuration found for workbook:")) {
    const keys = Object.keys(configData?.["excel-projects"] || {});
    if (keys.length) {
      message += `\n\nAvailable keys: [${keys.join(", ")}] or add "*" as fallback`;
    }
  }
  
  return message;
}