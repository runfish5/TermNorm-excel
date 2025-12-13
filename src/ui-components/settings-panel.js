/**
 * Settings Panel - Minimal, vanilla implementation
 */
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { getStateValue } from "../core/state-actions.js";
import { saveSetting } from "../services/workflows.js";
import { showMessage } from "../utils/error-display.js";
import { renewPrompt } from "../services/prompt-renewer.js";
import { loadAvailableProviders, saveLlmProvider, setBraveApi, setWebSearch, DEFAULTS } from "../utils/settings-manager.js";
import { getCompactVersionString } from "../utils/app-utilities.js";
import { $ } from "../utils/dom-helpers.js";

const HTML = `
<div class="settings-panel">
  <h3 class="settings-title">Settings</h3>

  <div class="settings-section">
    <h4 class="settings-section-title">General</h4>
    <label class="settings-toggle">
      <input type="checkbox" id="set-require-server">
      <div class="settings-toggle-content">
        <span class="settings-toggle-label">Require server connection</span>
        <span class="settings-toggle-hint">For mapping operations</span>
      </div>
    </label>
    <label class="settings-toggle">
      <input type="checkbox" id="set-brave-api">
      <div class="settings-toggle-content">
        <span class="settings-toggle-label">Use Brave Search API</span>
        <span class="settings-toggle-hint">Primary web scraper when configured</span>
      </div>
    </label>
  </div>

  <div class="settings-section">
    <h4 class="settings-section-title">LLM Model</h4>
    <div class="settings-form-row">
      <label for="set-llm-provider">Provider</label>
      <select id="set-llm-provider"><option>Loading...</option></select>
    </div>
    <div class="settings-form-row">
      <label for="set-llm-model">Model</label>
      <input type="text" id="set-llm-model" placeholder="e.g. llama-3.3-70b">
    </div>
    <div class="settings-form-actions">
      <button id="set-llm-apply" class="btn btn-primary btn-sm">Apply</button>
      <span class="llm-status"><span id="set-llm-dot" class="llm-status-dot"></span><span id="set-llm-status">Loading...</span></span>
    </div>
  </div>

  <div class="settings-section">
    <h4 class="settings-section-title">Actions</h4>
    <div class="settings-button-row">
      <button id="set-renew-prompt" class="btn btn-secondary btn-sm">Renew Prompt</button>
      <button id="set-reset" class="btn btn-ghost btn-sm">Reset Defaults</button>
    </div>
  </div>

  <footer class="settings-footer" id="set-version">TermNorm</footer>
</div>`;

let llmLoaded = false;

function setLlmStatus(state, text) {
  const dot = $("set-llm-dot"), label = $("set-llm-status");
  if (dot) dot.className = `llm-status-dot ${state}`;
  if (label) label.textContent = text;
}

async function loadLlm() {
  if (llmLoaded) return;
  const sel = $("set-llm-provider"), inp = $("set-llm-model"), btn = $("set-llm-apply");
  try {
    const data = await loadAvailableProviders();
    if (!data?.available_providers) {
      sel.innerHTML = "<option>Server offline</option>";
      inp.disabled = btn.disabled = true;
      setLlmStatus("offline", "Offline");
      return;
    }
    sel.innerHTML = data.available_providers.map(p => `<option${p === data.current_provider ? " selected" : ""}>${p}</option>`).join("");
    inp.value = data.current_model || "";
    inp.disabled = btn.disabled = false;
    setLlmStatus("connected", data.current_provider);
    llmLoaded = true;
  } catch (e) {
    sel.innerHTML = "<option>Error</option>";
    inp.disabled = btn.disabled = true;
    setLlmStatus("error", "Error");
  }
}

async function applyLlm() {
  const provider = $("set-llm-provider")?.value, model = $("set-llm-model")?.value?.trim();
  if (!provider || !model) return showMessage("Select provider and model", "error");
  const btn = $("set-llm-apply");
  btn.disabled = true;
  try {
    await saveLlmProvider(provider, model);
    setLlmStatus("connected", provider);
    showMessage(`LLM: ${provider}/${model}`);
  } catch (e) { showMessage(`Failed: ${e.message}`, "error"); }
  btn.disabled = false;
}

function bindToggle(id, key, apiCall) {
  const cb = $(id);
  if (!cb) return;
  cb.checked = getStateValue(`settings.${key}`) ?? DEFAULTS[key];
  cb.onchange = async () => {
    saveSetting(key, cb.checked);
    if (apiCall) {
      try { await apiCall(cb.checked); }
      catch (e) { cb.checked = !cb.checked; saveSetting(key, cb.checked); showMessage(e.message, "error"); }
    }
  };
}

export function init(containerId = "settings-panel-container") {
  const el = $(containerId);
  if (!el) return false;
  el.innerHTML = HTML;

  // Version footer
  $("set-version").textContent = getCompactVersionString();

  // Toggles
  bindToggle("set-require-server", "requireServerOnline");
  bindToggle("set-brave-api", "useBraveApi", setBraveApi);

  // LLM
  $("set-llm-apply")?.addEventListener("click", applyLlm);

  // Actions
  $("set-renew-prompt")?.addEventListener("click", async () => {
    const mappings = getStateValue("mappings.combined"), config = getStateValue("config");
    await renewPrompt(mappings, config, (msg, err) => showMessage(msg, err ? "error" : "info"));
  });

  $("set-reset")?.addEventListener("click", async () => {
    if (!confirm("Reset all settings to defaults?")) return;
    localStorage.removeItem("termnorm_settings");
    Object.entries(DEFAULTS).forEach(([k, v]) => saveSetting(k, v));
    try { await Promise.all([setBraveApi(true), setWebSearch(true)]); } catch {}
    $("set-require-server").checked = $("set-brave-api").checked = true;
    showMessage("Settings reset");
  });

  // Load LLM on panel open
  eventBus.on(Events.SETTINGS_PANEL_OPENED, loadLlm);
  eventBus.on(Events.SERVER_STATUS_CHANGED, ({ online }) => { if (!online) setLlmStatus("offline", "Offline"); });

  return true;
}
