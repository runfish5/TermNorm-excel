/**
 * Thermo Builder - Dynamically builds the research thermometer from pipeline.json config.
 * ON nodes are connected left-to-right with SVG ribbons; OFF nodes sit after a separator.
 */
import { Thermometer } from "./thermometer.js";
import { getStateValue } from "../core/state-actions.js";
import { saveSetting } from "../utils/settings-manager.js";
import { showMessage } from "../utils/ui-feedback.js";
import frontendPipeline from "../config/pipeline.json";

const SVG_NS = "http://www.w3.org/2000/svg";
const display = frontendPipeline.thermo_display || {};
const order = frontendPipeline.thermo_order || [];

function createStep(key, cfg, stepNum) {
  const div = document.createElement("div");
  div.className = "thermo__step";
  if (cfg.color) div.classList.add(`thermo__step--color-${cfg.color}`);
  div.dataset.step = stepNum;
  div.dataset.key = key;
  div.innerHTML = `<span class="thermo__bubble"><span class="thermo__led"></span></span><span class="thermo__label">${cfg.label}</span>`;
  if (cfg.params) {
    const lines = Object.entries(cfg.params).map(([k, v]) => `${k}: ${v}`);
    div.title = `${key}\n${lines.join("\n")}`;
  }
  return div;
}

function createRibbon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("thermo__ribbon");
  svg.setAttribute("viewBox", "0 0 100 44");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#ribbon-path");
  svg.appendChild(use);
  return svg;
}

/**
 * Build the research thermometer DOM inside a container.
 * @param {HTMLElement} container - The thermo container element
 * @returns {string[]} List of toggleable node keys
 */
export function buildResearchThermo(container) {
  container.innerHTML = "";
  const toggleableKeys = [];

  // Partition nodes into ON and OFF based on current settings
  const onNodes = [];
  const offNodes = [];
  for (const key of order) {
    const cfg = display[key];
    if (!cfg) continue;
    const isOn = cfg.settingKey
      ? getStateValue(`settings.${cfg.settingKey}`) ?? cfg.defaultOn
      : cfg.defaultOn;
    (isOn ? onNodes : offNodes).push(key);
    if (cfg.settingKey) toggleableKeys.push(key);
  }

  // ON nodes with ribbons between them
  onNodes.forEach((key, i) => {
    container.appendChild(createStep(key, display[key], i + 1));
    if (i < onNodes.length - 1) container.appendChild(createRibbon());
  });

  // Separator + OFF nodes (if any)
  if (offNodes.length > 0) {
    const sep = document.createElement("div");
    sep.className = "thermo__separator";
    container.appendChild(sep);
    offNodes.forEach((key, i) => {
      const step = createStep(key, display[key], onNodes.length + i + 1);
      step.classList.add("thermo__step--disabled");
      container.appendChild(step);
    });
  }

  return toggleableKeys;
}

/**
 * Destroy old instance, rebuild DOM, return fresh Thermometer instance.
 * @param {string} containerId - Element ID of the thermo container
 * @returns {{ thermo: object|null, toggleableKeys: string[] }}
 */
export function rebuildResearchThermo(containerId) {
  Thermometer.destroy(containerId);
  const container = document.getElementById(containerId);
  if (!container) return { thermo: null, toggleableKeys: [] };
  const toggleableKeys = buildResearchThermo(container);
  const thermo = Thermometer.init(containerId);
  return { thermo, toggleableKeys };
}

/**
 * Build (or rebuild) the research thermometer with toggle callbacks.
 * Returns the Thermometer instance (or null if container missing).
 * @param {string} containerId - Element ID of the thermo container
 * @param {Object} thermoDisplay - Pipeline thermo_display config
 * @returns {object|null} Thermometer instance
 */
export function initResearchThermo(containerId, thermoDisplay) {
  const { thermo, toggleableKeys } = rebuildResearchThermo(containerId);
  if (!thermo) return null;

  // Mark toggleable nodes and set their initial on/off state
  for (const key of toggleableKeys) {
    const cfg = thermoDisplay[key];
    if (!cfg?.settingKey) continue;
    const isOn = getStateValue(`settings.${cfg.settingKey}`) ?? cfg.defaultOn;
    thermo.setToggleable(key, isOn);
  }

  // Toggle callback: save setting -> rebuild -> show message
  thermo.onToggle = (key, enabled) => {
    const cfg = thermoDisplay[key];
    if (!cfg?.settingKey) return;
    saveSetting(cfg.settingKey, enabled);
    initResearchThermo(containerId, thermoDisplay);
    showMessage(`${cfg.label} ${enabled ? 'ON' : 'OFF'}`);
  };

  return thermo;
}
