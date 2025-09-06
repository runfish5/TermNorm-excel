// ui-components/file-handling.js
// File drag & drop and processing functionality

import { LiveTracker } from "../services/live.tracker.js";
import { aiPromptRenewer } from "../services/aiPromptRenewer.js";
import { createMappingConfigHTML, setupMappingConfigEvents, loadMappingConfigData } from "./mapping-config-functions.js";
import { state } from "../shared-services/state.manager.js";
import { getCurrentWorkbookName } from "../utils/app-utilities.js";
import { showView } from "./view-manager.js";

// Ultra-simple vanilla drag/drop - works in both local and cloud Excel
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
  state.setStatus("Opening file dialog...");

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      state.setStatus(`File selected: ${file.name} - Processing...`);
      await processFile(file);
    } else {
      state.setStatus("No file selected", true);
    }
  };
  input.click();
}

async function processFile(file) {
  state.setStatus(`Processing file: ${file.name}`);
  try {
    if (!file.name.endsWith(".json")) {
      state.setStatus("Please select a JSON configuration file", true);
      return;
    }

    const reader = new FileReader();

    reader.onerror = () => state.setStatus("Failed to read file - file might be corrupted", true);
    reader.onabort = () => state.setStatus("File reading was aborted", true);

    reader.onload = async function (e) {
      try {
        const configData = JSON.parse(e.target.result);
        await loadConfigData(configData, file.name);
      } catch (error) {
        state.setStatus(`Invalid JSON file - ${error.message}`, true);
      }
    };

    reader.readAsText(file);
  } catch (error) {
    state.setStatus(`File processing failed - ${error.message}`, true);
  }
}

async function loadConfigData(configData, fileName) {
  try {
    if (!configData?.["excel-projects"]) {
      throw new Error("Invalid config format - missing excel-projects structure");
    }

    state.set("config.raw", configData);

    // Get workbook name
    const workbook = await getCurrentWorkbookName();

    // Find matching config
    const config = configData["excel-projects"][workbook] || configData["excel-projects"]["*"];
    const availableWorkbooks = Object.keys(configData["excel-projects"]).join(", ");

    if (!config?.standard_mappings?.length) {
      throw new Error(`No valid configuration found for workbook: "${workbook}". Available: ${availableWorkbooks}`);
    }

    state.setConfig({ ...config, workbook });

    // Ensure UI container exists
    let container = document.getElementById("mapping-configs-container");
    if (!container && window.showView) {
      showView("setup");
      await new Promise((resolve) => setTimeout(resolve, 100));
      container = document.getElementById("mapping-configs-container");
    }

    if (!container) {
      throw new Error("Configuration UI container not available - please refresh the add-in");
    }

    // Ensure global objects are available (fallback if not initialized)
    !window.tracker && Object.assign(window, { tracker: new LiveTracker(), aiRenewer: new aiPromptRenewer((msg, isError) => state.setStatus(msg, isError)), mappingModules: [] });

    await reloadMappingModules();

    const finalContainer = document.getElementById("mapping-configs-container");
    if (!finalContainer?.children.length) {
      throw new Error("Module reload completed but no UI elements were created - check configuration");
    }

    state.setStatus(
      `Configuration loaded from ${fileName} - Found ${config.standard_mappings.length} standard mapping(s)`
    );
  } catch (error) {
    state.setStatus(error.message, true);
  }
}

export async function reloadMappingModules() {
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
      state.setStatus(`Module ${index + 1} init failed: ${initError.message}`, true);
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
  const content = document.getElementById("metadata-content"), sources = state.get("mappings.sources") || {};
  if (!content || !Object.keys(sources).length) return;
  content.innerHTML = `<div style="margin-top: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-family: monospace; font-size: 12px;"><strong>Raw Data:</strong><pre style="margin: 5px 0; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(Object.entries(sources).map(([index, { mappings, result }]) => ({ sourceIndex: +index + 1, forwardMappings: Object.keys(mappings.forward || {}).length, reverseMappings: Object.keys(mappings.reverse || {}).length, metadata: result.metadata, mappings })), null, 2)}</pre></div>`;
}

function updateGlobalStatus() {
  const loaded = Object.keys(state.get("mappings.sources") || {}).length, total = window.mappingModules?.length || 0;
  state.setStatus(loaded === 0 ? "Ready to load mapping configurations..." : loaded === total ? `All ${total} mapping sources loaded` : `${loaded}/${total} mapping sources loaded`);
}