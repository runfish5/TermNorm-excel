// ui-components/file-handling.js - File drag & drop and processing
import { createMappingConfigHTML, setupMappingConfigEvents, loadMappingConfigData } from "./mapping-config.js";
import { getStateValue, setConfig, setServerHost } from "../core/state-actions.js";
import { getCurrentWorkbookName } from "../utils/app-utilities.js";
import { showView } from "../utils/dom-helpers.js";
import { showMessage } from "../utils/error-display.js";

let mappingModules = [];

function extractProjectConfig(configData, workbook) {
  if (!configData?.["excel-projects"]) throw new Error("Invalid config - missing excel-projects");
  const projects = configData["excel-projects"], config = projects[workbook] || projects["*"];
  if (!config?.standard_mappings?.length) throw new Error(`No config for "${workbook}". Available: ${Object.keys(projects).join(", ")}`);
  return config;
}

function setStepStates(success) {
  document.querySelectorAll("#setup-view .settings-group").forEach((el, i) => el.open = success ? [false, false, true, true][i] : [false, true, false, true][i]);
}

async function applyConfig(configData, source) {
  if (configData.backend_url) { setServerHost(configData.backend_url); const input = document.getElementById("server-url-input"); if (input) input.value = configData.backend_url; }
  const workbook = await getCurrentWorkbookName(), config = extractProjectConfig(configData, workbook);
  setConfig({ ...config, workbook }, configData);
  await ensureUISetup();
  await reloadMappingModules();
  showMessage(`${source}: ${config.standard_mappings.length} mapping(s)`);
  setStepStates(true);
}

export async function loadStaticConfig() {
  try {
    const configData = getStateValue('config.raw') || (await import("../../config/app.config.json")).default;
    await applyConfig(configData, "Loaded");
  } catch (error) {
    const keys = Object.keys(getStateValue('config.raw')?.["excel-projects"] || {});
    showMessage(`Config failed: ${error.message}${keys.length ? `\n\nAvailable: [${keys.join(", ")}]` : ""}`, "error");
    setStepStates(false);
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
  const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json" });
  input.onchange = (e) => e.target.files[0] && processFile(e.target.files[0]);
  input.click();
}

async function processFile(file) {
  if (!file.name.endsWith(".json")) return showMessage("Please select a JSON config file", "error");
  try { await applyConfig(JSON.parse(await file.text()), `Loaded from ${file.name}`); }
  catch (e) { showMessage(`${e instanceof SyntaxError ? "Invalid JSON" : "Failed"}: ${e.message}`, "error"); setStepStates(false); }
}

async function ensureUISetup() {
  showView("setup");
  await new Promise(r => setTimeout(r, 50));
  if (!document.getElementById("mapping-configs-container")) throw new Error("Config container missing");
}

export async function reloadMappingModules() {
  const mappings = getStateValue('config.data')?.standard_mappings || [];
  const container = document.getElementById("mapping-configs-container");
  if (!mappings.length || !container) return;

  container.innerHTML = "";
  mappingModules = mappings.map((config, i) => {
    const el = Object.assign(document.createElement("details"), { id: `mapping-config-${i}`, className: "content-section mapping-config-module", open: true });
    el.innerHTML = createMappingConfigHTML(config, i);
    container.appendChild(el);
    const api = setupMappingConfigEvents(el, config, i, updateGlobalStatus);
    loadMappingConfigData(el, config);
    return { element: el, getMappings: api.getMappings, index: i };
  });
  updateGlobalStatus();
}

function updateGlobalStatus() {
  const loaded = Object.keys(getStateValue('mappings.sources') || {}).length, total = getStateValue('config.data')?.standard_mappings?.length || 0;
  showMessage(!loaded ? "Ready to load mappings..." : loaded === total ? `All ${total} sources loaded` : `${loaded}/${total} sources loaded`);
  updateJsonDump();
}

function updateJsonDump() {
  const content = document.getElementById("metadata-content"), sources = getStateValue('mappings.sources') || {};
  if (!content || !Object.keys(sources).length) return;
  const data = Object.entries(sources).map(([i, s]) => ({
    sourceIndex: +i + 1,
    status: s.status,
    forwardMappings: Object.keys(s.data?.forward || {}).length,
    reverseMappings: Object.keys(s.data?.reverse || {}).length,
    metadata: s.data?.metadata
  }));
  content.querySelector("#metadata-display").innerHTML = `<pre style="white-space: pre-wrap; word-break: break-all; font-size: 11px;">${JSON.stringify(data, null, 2)}</pre>`;
}
