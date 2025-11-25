// ui-components/file-handling.js
// File drag & drop and processing functionality

import {
  createMappingConfigHTML,
  setupMappingConfigEvents,
  loadMappingConfigData,
} from "./mapping-config-functions.js";
import { state, setConfig } from "../shared-services/state-machine.manager.js";
import { getCurrentWorkbookName } from "../utils/app-utilities.js";
import { showView } from "./view-manager.js";
import { showMessage } from "../utils/error-display.js";

function setStepStates(s1, s2, s3, s4) {
  document.querySelectorAll("#setup-view .settings-group").forEach((el, i) => {
    el.open = [s1, s2, s3, s4][i];
  });
}

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

// Load config from static file (used during initialization)
export async function loadStaticConfig() {
  try {
    const workbook = await getCurrentWorkbookName();

    let configData = state.config.raw;
    if (!configData) {
      configData = (await import("../../config/app.config.json")).default;
      state.config.raw = configData;
    }

    // Load global backend URL (if specified)
    if (configData.backend_url) {
      state.server.host = configData.backend_url;

      // Update UI to show loaded URL
      const serverUrlInput = document.getElementById("server-url-input");
      if (serverUrlInput) {
        serverUrlInput.value = configData.backend_url;
      }
    }

    // Inline validation - check structure
    if (!configData?.["excel-projects"]) {
      throw new Error("Invalid config format - missing excel-projects structure");
    }

    // Inline config selection
    const projects = configData["excel-projects"];
    const config = projects[workbook] || projects["*"];

    if (!config?.standard_mappings?.length) {
      const available = Object.keys(projects).join(", ");
      throw new Error(`No valid configuration found for workbook: "${workbook}". Available: ${available}`);
    }

    setConfig({ ...config, workbook });

    // Ensure UI setup and initialize modules
    await ensureUISetup();
    await reloadMappingModules();

    showMessage(`Config loaded - Found ${config.standard_mappings.length} standard mapping(s)`);
    setStepStates(false, false, true, true);
  } catch (error) {
    const configData = state.config.raw;
    const errorMessage = buildConfigErrorMessage(error, configData);
    showMessage(errorMessage, "error");
    setStepStates(false, true, false, true);
    throw error;
  }
}

export function setupFileHandling() {
  const dropZone = document.getElementById("drop-zone");
  if (!dropZone) return;

  // Prevent default browser behavior
  ["dragenter", "dragover", "dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });

  // Highlight drop zone when item is dragged over it
  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, highlight, false);
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, unhighlight, false);
  });

  // Handle dropped files
  dropZone.addEventListener("drop", handleDrop, false);

  // Handle click to open file dialog
  dropZone.addEventListener("click", openFileDialog, false);
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

function highlight() {
  document.getElementById("drop-zone").classList.add("highlight");
}

function unhighlight() {
  document.getElementById("drop-zone").classList.remove("highlight");
}

function handleDrop(e) {
  const files = e.dataTransfer.files;
  [...files].forEach(processFile);
}

function openFileDialog() {
  // Immediate feedback that dialog was clicked
  showMessage("Opening file dialog...");

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      showMessage(`File selected: ${file.name} - Processing...`);
      await processFile(file);
    } else {
      showMessage("No file selected", "error");
    }
  };
  input.click();
}

async function processFile(file) {
  if (!file.name.endsWith(".json")) {
    return showMessage("Please select a JSON configuration file", "error");
  }

  showMessage(`Processing file: ${file.name}`);

  try {
    const text = await file.text();
    const configData = JSON.parse(text);
    await loadConfigData(configData, file.name);
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? `Invalid JSON file - ${error.message}`
        : `File processing failed - ${error.message}`;
    showMessage(message, "error");
  }
}

async function loadConfigData(configData, fileName) {
  try {
    // Load global backend URL (if specified)
    if (configData.backend_url) {
      state.server.host = configData.backend_url;

      // Update UI to show loaded URL
      const serverUrlInput = document.getElementById("server-url-input");
      if (serverUrlInput) {
        serverUrlInput.value = configData.backend_url;
      }
    }

    // Inline validation and selection
    if (!configData?.["excel-projects"]) {
      throw new Error("Invalid config format - missing excel-projects structure");
    }
    state.config.raw = configData;

    const workbook = await getCurrentWorkbookName();
    const projects = configData["excel-projects"];
    const config = projects[workbook] || projects["*"];

    if (!config?.standard_mappings?.length) {
      const available = Object.keys(projects).join(", ");
      throw new Error(`No valid configuration found for workbook: "${workbook}". Available: ${available}`);
    }

    setConfig({ ...config, workbook });

    // Ensure UI setup and initialize modules
    await ensureUISetup();
    await reloadMappingModules();

    showMessage(`Configuration loaded from ${fileName} - Found ${config.standard_mappings.length} standard mapping(s)`);
    setStepStates(false, false, true, true);
  } catch (error) {
    showMessage(error.message, "error");
    setStepStates(false, true, false, true);
  }
}

// Simplified UI setup
async function ensureUISetup() {
  showView("setup");

  // Brief delay to ensure DOM is ready
  await new Promise((resolve) => setTimeout(resolve, 50));

  const container = document.getElementById("mapping-configs-container");
  if (!container) {
    throw new Error("Configuration UI container not available - please refresh the add-in");
  }

  // Initialize global modules if needed
  window.mappingModules = window.mappingModules || [];
}

export async function reloadMappingModules() {
  const config = state.config.data;
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
  window.mappingModules = [];

  // Create new modules using direct functions
  window.mappingModules = standardMappings.map((config, index) => {
    const elementId = `mapping-config-${index}`;

    try {
      // Create element
      const element = document.createElement("details");
      element.id = elementId;
      element.className = "ms-welcome__section mapping-config-module";
      element.open = true;
      element.innerHTML = createMappingConfigHTML(config, index);

      container.appendChild(element);

      // Setup events and get mapping accessor
      const moduleAPI = setupMappingConfigEvents(element, config, index, () => onMappingLoaded());

      // Load initial data
      loadMappingConfigData(element, config);

      return { element, getMappings: moduleAPI.getMappings, index };
    } catch (initError) {
      showMessage(`Module ${index + 1} init failed: ${initError.message}`, "error");
      return { element: null, getMappings: () => ({ forward: {}, reverse: {}, metadata: null }), index };
    }
  });

  updateGlobalStatus();
}

function onMappingLoaded() {
  updateGlobalStatus();
  updateJsonDump();
}

function updateJsonDump() {
  const content = document.getElementById("metadata-content"),
    sources = state.mappings.sources || {};
  if (!content || !Object.keys(sources).length) return;
  content.innerHTML = `<div style="margin-top: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-family: monospace; font-size: 12px;"><strong>Raw Data:</strong><pre style="margin: 5px 0; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(
    Object.entries(sources).map(([index, source]) => ({
      sourceIndex: +index + 1,
      status: source.status,
      forwardMappings: Object.keys(source.data?.forward || {}).length,
      reverseMappings: Object.keys(source.data?.reverse || {}).length,
      metadata: source.data?.metadata,
      lastSyncTime: source.lastSyncTime,
    })),
    null,
    2
  )}</pre></div>`;
}

function updateGlobalStatus() {
  const loaded = Object.keys(state.mappings.sources || {}).length,
    total = state.config.data?.standard_mappings?.length || 0;
  showMessage(
    loaded === 0
      ? "Ready to load mapping configurations..."
      : loaded === total
        ? `All ${total} mapping sources loaded`
        : `${loaded}/${total} mapping sources loaded`
  );
}
