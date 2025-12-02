// ui-components/file-handling.js
// File drag & drop and processing functionality

import {
  createMappingConfigHTML,
  setupMappingConfigEvents,
  loadMappingConfigData,
} from "./mapping-config-functions.js";
import { getStateValue, setConfig as setConfigAction, setServerHost } from "../core/state-actions.js";
import { setConfig } from "../shared-services/state-machine.manager.js";
import { getCurrentWorkbookName } from "../utils/app-utilities.js";
import { showView } from "./view-manager.js";
import { showMessage } from "../utils/error-display.js";

function setStepStates(s1, s2, s3, s4) {
  document.querySelectorAll("#setup-view .settings-group").forEach((el, i) => {
    el.open = [s1, s2, s3, s4][i];
  });
}

function updateBackendUrl(url) {
  setServerHost(url);
  const input = document.getElementById("server-url-input");
  if (input) input.value = url;
}

export function buildConfigErrorMessage(error, configData) {
  const keys = Object.keys(configData?.["excel-projects"] || {});
  return `Config failed: ${error.message}${
    error.message.includes("No valid configuration found") && keys.length
      ? `\n\nAvailable: [${keys.join(", ")}] or add "*"`
      : ""
  }`;
}

// Load config from static file (used during initialization)
export async function loadStaticConfig() {
  try {
    const workbook = await getCurrentWorkbookName();

    let configData = getStateValue('config.raw');
    if (!configData) {
      configData = (await import("../../config/app.config.json")).default;
    }

    if (configData.backend_url) updateBackendUrl(configData.backend_url);

    if (!configData?.["excel-projects"]) {
      throw new Error("Invalid config - missing excel-projects");
    }

    const projects = configData["excel-projects"];
    const config = projects[workbook] || projects["*"];

    if (!config?.standard_mappings?.length) {
      const available = Object.keys(projects).join(", ");
      throw new Error(`No config for "${workbook}". Available: ${available}`);
    }

    setConfig({ ...config, workbook }, configData);

    await ensureUISetup();
    await reloadMappingModules();

    showMessage(`Loaded ${config.standard_mappings.length} mapping(s)`);
    setStepStates(false, false, true, true);
  } catch (error) {
    const configData = getStateValue('config.raw');
    const errorMessage = buildConfigErrorMessage(error, configData);
    showMessage(errorMessage, "error");
    setStepStates(false, true, false, true);
    throw error;
  }
}

export function setupFileHandling() {
  const dropZone = document.getElementById("drop-zone");
  if (!dropZone) return;

  const prevent = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  ["dragenter", "dragover", "dragleave", "drop"].forEach((e) => {
    dropZone.addEventListener(e, prevent, false);
    document.body.addEventListener(e, prevent, false);
  });
  ["dragenter", "dragover"].forEach((e) =>
    dropZone.addEventListener(e, () => dropZone.classList.add("highlight"), false)
  );
  ["dragleave", "drop"].forEach((e) =>
    dropZone.addEventListener(e, () => dropZone.classList.remove("highlight"), false)
  );
  dropZone.addEventListener("drop", handleDrop, false);
  dropZone.addEventListener("click", openFileDialog, false);
}

function handleDrop(e) {
  const files = e.dataTransfer.files;
  [...files].forEach(processFile);
}

function openFileDialog() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      showMessage(`File selected: ${file.name} - Processing...`);
      await processFile(file);
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
    showMessage(
      `${error instanceof SyntaxError ? "Invalid JSON" : "File processing failed"} - ${error.message}`,
      "error"
    );
  }
}

async function loadConfigData(configData, fileName) {
  try {
    if (configData.backend_url) updateBackendUrl(configData.backend_url);

    if (!configData?.["excel-projects"]) {
      throw new Error("Invalid config - missing excel-projects");
    }

    const workbook = await getCurrentWorkbookName();
    const projects = configData["excel-projects"];
    const config = projects[workbook] || projects["*"];

    if (!config?.standard_mappings?.length) {
      const available = Object.keys(projects).join(", ");
      throw new Error(`No config for "${workbook}". Available: ${available}`);
    }

    setConfig({ ...config, workbook }, configData);

    await ensureUISetup();
    await reloadMappingModules();

    showMessage(`Config loaded from ${fileName} - ${config.standard_mappings.length} mapping(s)`);
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
    throw new Error("Config container missing - refresh add-in");
  }

  // Initialize global modules if needed
  window.mappingModules = window.mappingModules || [];
}

export async function reloadMappingModules() {
  const config = getStateValue('config.data');
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
    sources = getStateValue('mappings.sources') || {};
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
  const loaded = Object.keys(getStateValue('mappings.sources') || {}).length,
    total = getStateValue('config.data')?.standard_mappings?.length || 0;
  showMessage(
    loaded === 0
      ? "Ready to load mapping configurations..."
      : loaded === total
        ? `All ${total} mapping sources loaded`
        : `${loaded}/${total} mapping sources loaded`
  );
}
