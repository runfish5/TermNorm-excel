// ui-components/file-handling.js - File drag & drop and processing
import { createMappingConfigHTML, setupMappingConfigEvents, loadMappingConfigData } from "./mapping-config-functions.js";
import { getStateValue, setConfig, setServerHost } from "../core/state-actions.js";
import { getCurrentWorkbookName } from "../utils/app-utilities.js";
import { showView } from "./view-manager.js";
import { showMessage } from "../utils/error-display.js";

let mappingModules = [];

function extractProjectConfig(configData, workbook) {
  if (!configData?.["excel-projects"]) throw new Error("Invalid config - missing excel-projects");
  const projects = configData["excel-projects"];
  const config = projects[workbook] || projects["*"];
  if (!config?.standard_mappings?.length) {
    throw new Error(`No config for "${workbook}". Available: ${Object.keys(projects).join(", ")}`);
  }
  return config;
}

function setStepStates(s1, s2, s3, s4) {
  document.querySelectorAll("#setup-view .settings-group").forEach((el, i) => el.open = [s1, s2, s3, s4][i]);
}

function updateBackendUrl(url) {
  setServerHost(url);
  const input = document.getElementById("server-url-input");
  if (input) input.value = url;
}

export function buildConfigErrorMessage(error, configData) {
  const keys = Object.keys(configData?.["excel-projects"] || {});
  return `Config failed: ${error.message}${error.message.includes("No valid configuration found") && keys.length ? `\n\nAvailable: [${keys.join(", ")}] or add "*"` : ""}`;
}

export async function loadStaticConfig() {
  try {
    const workbook = await getCurrentWorkbookName();
    let configData = getStateValue('config.raw') || (await import("../../config/app.config.json")).default;

    if (configData.backend_url) updateBackendUrl(configData.backend_url);
    const config = extractProjectConfig(configData, workbook);
    setConfig({ ...config, workbook }, configData);

    await ensureUISetup();
    await reloadMappingModules();

    showMessage(`Loaded ${config.standard_mappings.length} mapping(s)`);
    setStepStates(false, false, true, true);
  } catch (error) {
    showMessage(buildConfigErrorMessage(error, getStateValue('config.raw')), "error");
    setStepStates(false, true, false, true);
    throw error;
  }
}

export function setupFileHandling() {
  const dropZone = document.getElementById("drop-zone");
  if (!dropZone) return;

  const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
  ["dragenter", "dragover", "dragleave", "drop"].forEach((e) => {
    dropZone.addEventListener(e, prevent, false);
    document.body.addEventListener(e, prevent, false);
  });
  ["dragenter", "dragover"].forEach((e) => dropZone.addEventListener(e, () => dropZone.classList.add("highlight"), false));
  ["dragleave", "drop"].forEach((e) => dropZone.addEventListener(e, () => dropZone.classList.remove("highlight"), false));
  dropZone.addEventListener("drop", (e) => [...e.dataTransfer.files].forEach(processFile), false);
  dropZone.addEventListener("click", openFileDialog, false);
}

function openFileDialog() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) { showMessage(`File selected: ${file.name} - Processing...`); await processFile(file); }
  };
  input.click();
}

async function processFile(file) {
  if (!file.name.endsWith(".json")) return showMessage("Please select a JSON configuration file", "error");
  showMessage(`Processing file: ${file.name}`);
  try {
    await loadConfigData(JSON.parse(await file.text()), file.name);
  } catch (error) {
    showMessage(`${error instanceof SyntaxError ? "Invalid JSON" : "File processing failed"} - ${error.message}`, "error");
  }
}

async function loadConfigData(configData, fileName) {
  try {
    if (configData.backend_url) updateBackendUrl(configData.backend_url);
    const workbook = await getCurrentWorkbookName();
    const config = extractProjectConfig(configData, workbook);
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

async function ensureUISetup() {
  showView("setup");
  await new Promise((r) => setTimeout(r, 50));
  if (!document.getElementById("mapping-configs-container")) throw new Error("Config container missing - refresh add-in");
  mappingModules = mappingModules || [];
}

export async function reloadMappingModules() {
  const standardMappings = getStateValue('config.data')?.standard_mappings || [];
  if (!standardMappings.length) return;

  const container = document.getElementById("mapping-configs-container");
  if (!container) throw new Error("Mapping configs container not found");

  container.innerHTML = "";
  mappingModules = standardMappings.map((config, index) => {
    try {
      const element = document.createElement("details");
      element.id = `mapping-config-${index}`;
      element.className = "ms-welcome__section mapping-config-module";
      element.open = true;
      element.innerHTML = createMappingConfigHTML(config, index);
      container.appendChild(element);

      const moduleAPI = setupMappingConfigEvents(element, config, index, () => { updateGlobalStatus(); updateJsonDump(); });
      loadMappingConfigData(element, config);
      return { element, getMappings: moduleAPI.getMappings, index };
    } catch (initError) {
      showMessage(`Module ${index + 1} init failed: ${initError.message}`, "error");
      return { element: null, getMappings: () => ({ forward: {}, reverse: {}, metadata: null }), index };
    }
  });
  updateGlobalStatus();
}

function updateJsonDump() {
  const content = document.getElementById("metadata-content"), sources = getStateValue('mappings.sources') || {};
  if (!content || !Object.keys(sources).length) return;
  content.innerHTML = `<div style="margin-top: 15px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-family: monospace; font-size: 12px;"><strong>Raw Data:</strong><pre style="margin: 5px 0; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(Object.entries(sources).map(([i, s]) => ({ sourceIndex: +i + 1, status: s.status, forwardMappings: Object.keys(s.data?.forward || {}).length, reverseMappings: Object.keys(s.data?.reverse || {}).length, metadata: s.data?.metadata, lastSyncTime: s.lastSyncTime })), null, 2)}</pre></div>`;
}

function updateGlobalStatus() {
  const loaded = Object.keys(getStateValue('mappings.sources') || {}).length;
  const total = getStateValue('config.data')?.standard_mappings?.length || 0;
  showMessage(loaded === 0 ? "Ready to load mapping configurations..." : loaded === total ? `All ${total} mapping sources loaded` : `${loaded}/${total} mapping sources loaded`);
}
