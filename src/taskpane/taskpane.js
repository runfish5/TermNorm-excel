import { startTracking } from "../services/live-tracker.js";
import { renewPrompt } from "../services/prompt-renewer.js";
import { init as initHistory, updateHistoryTabCounter } from "../ui-components/processing-history.js";
import { init as initBatch } from "../ui-components/batch-processing.js";
import { init as initCandidates } from "../ui-components/candidate-ranking.js";
import { setupServerEvents, checkServerStatus } from "../utils/server-utilities.js";
import { initializeHistoryCache } from "../utils/history-cache.js";
import { initializeSettings, saveSetting } from "../services/state-manager.js";
import { getStateValue } from "../core/state-actions.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { initializeVersionDisplay, initializeProjectPathDisplay, updateContentMargin } from "../utils/app-utilities.js";
import { showView, setupButton } from "../utils/dom-helpers.js";
import { setupFileHandling, loadStaticConfig } from "../ui-components/file-handling.js";
import { showMessage } from "../utils/error-display.js";
import { updateAllIndicators, setupIndicators } from "../utils/status-indicators.js";

const $ = id => document.getElementById(id);
const refresh = () => { updateAllIndicators(); updateButtonStates(); };

function setupUIReactivity() {
  [Events.SERVER_STATUS_CHANGED, Events.MAPPINGS_LOADED, Events.SETTING_CHANGED].forEach(e => eventBus.on(e, refresh));
  eventBus.on(Events.CONFIG_LOADED, updateButtonStates);
  refresh();
}

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) return $("sideload-msg").textContent = "This add-in requires Microsoft Excel";

  document.body.className = "ms-font-m ms-welcome ms-Fabric";
  initHistory(); initBatch(); initCandidates(); updateHistoryTabCounter();
  $("sideload-msg")?.classList.add("hidden");
  const appBody = $("app-body");
  if (appBody) { appBody.classList.remove("hidden"); appBody.style.display = "flex"; }

  initializeSettings(); setupFileHandling(); setupServerEvents(); setupIndicators();
  eventBus.on(Events.SERVER_RECONNECTED, () => initializeHistoryCache());
  setupUIReactivity();
  checkServerStatus(); initializeVersionDisplay(); initializeProjectPathDisplay();
  setupSettingsCheckboxes();

  setupButton("offline-mode-warning", () => { showView("settings"); showMessage("Offline mode active - re-enable in Settings"); });

  $("show-metadata-btn")?.addEventListener("click", () => {
    const c = $("metadata-content");
    if (c) { c.classList.toggle("hidden"); $("show-metadata-btn").textContent = c.classList.contains("hidden") ? "Show Processing Details" : "Hide Processing Details"; }
  });

  const modal = $("help-modal");
  $("help-icon-btn")?.addEventListener("click", () => modal?.classList.remove("hidden"));
  $("close-help-modal")?.addEventListener("click", () => modal?.classList.add("hidden"));
  modal?.addEventListener("click", (e) => e.target === modal && modal.classList.add("hidden"));

  $("setup-map-tracking")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Activating...";
    try { await startLiveTracking(); } catch (err) { showMessage(`Activation failed: ${err.message}`, "error"); }
    finally { e.target.disabled = false; e.target.textContent = "Activate Tracking"; }
  });

  $("renew-prompt")?.addEventListener("click", renewPromptHandler);

  document.addEventListener("click", async (e) => {
    const tab = e.target.closest(".nav-tab");
    if (tab) { e.preventDefault(); showView(tab.dataset.view); if (tab.dataset.view === "settings") await initializeLlmSettings(); }
  });

  updateContentMargin();
  const status = $("main-status-message");
  if (status) new MutationObserver(updateContentMargin).observe(status, { childList: true, subtree: true, characterData: true });
  window.addEventListener("resize", updateContentMargin);

  try { await loadStaticConfig(); } catch (err) { console.error("Init failed:", err); showMessage(`Init failed: ${err.message}`, "error"); }
});

function canActivateTracking() {
  const config = getStateValue('config.loaded'), mappings = getStateValue('mappings.combined'), online = getStateValue('server.online');
  if (!config) return { reason: "Load config file first" };
  if (!getStateValue('mappings.loaded') || !mappings) return { reason: "Load mapping files first" };
  if (!Object.keys(mappings?.forward || {}).length && !Object.keys(mappings?.reverse || {}).length) return { reason: "No mapping data" };
  if (getStateValue('settings.requireServerOnline') && !online) return { reason: "Server required (change in Settings)" };
  return { ok: true, warning: !online ? "⚠️ Server offline - exact/fuzzy only" : null };
}

function updateButtonStates() {
  const btn = $("setup-map-tracking");
  if (!btn) return;
  const v = canActivateTracking();
  btn.disabled = !v.ok;
  btn.title = v.ok ? "Start live cell tracking" : v.reason;
  btn.classList.toggle("disabled-with-reason", !v.ok);
}

async function startLiveTracking() {
  await checkServerStatus();
  const v = canActivateTracking();
  if (!v.ok) return showMessage(`❌ ${v.reason}`, "error");
  if (v.warning) showMessage(v.warning);

  try {
    const config = getStateValue('config.data'), mappings = getStateValue('mappings.combined');
    const terms = Object.keys(mappings.reverse || {}).length, online = getStateValue('server.online');
    const info = await startTracking(config, mappings);

    let msg = `✅ Tracking: ${terms} terms (${online ? "exact/fuzzy/LLM" : "exact/fuzzy only"})`;
    if (info.confidenceTotal > 0) {
      const { confidenceTotal: t, confidenceMapped: m, confidenceFound: f, confidenceMissing: x } = info;
      msg += `\n${m === t ? "✅" : "⚠️"} Confidence: ${m}/${t} columns`;
      if (x.length) msg += `\n❌ Missing: ${x.join(", ")}`;
    }
    showMessage(msg);
    showView("results");
  } catch (err) { showMessage(`Error: ${err.message}`, "error"); }
}

async function renewPromptHandler() {
  const config = getStateValue('config.data'), mappings = getStateValue('mappings.combined');
  if (!config || !mappings) return showMessage("Load config and mappings first", "error");
  await renewPrompt(mappings, config, (msg, err) => showMessage(msg, err ? "error" : "info"));
}

async function initializeLlmSettings() {
  const [sel, inp, btn] = [$("llm-provider-select"), $("llm-model-input"), $("apply-llm-settings")];
  try {
    const { loadAvailableProviders, saveLlmProvider } = await import("../utils/settings-manager.js");
    const data = await loadAvailableProviders();
    if (!data?.available_providers) { sel.innerHTML = '<option value="">Server offline</option>'; inp.disabled = btn.disabled = true; return; }

    sel.innerHTML = data.available_providers.map(p => `<option value="${p}" ${p === data.current_provider ? "selected" : ""}>${p}</option>`).join("");
    inp.value = data.current_model || "";
    inp.disabled = btn.disabled = false;

    btn.onclick = async () => {
      const provider = sel.value, model = inp.value.trim();
      if (!provider || !model) return showMessage("Provider and model required", "error");
      try { await saveLlmProvider(provider, model); showMessage(`LLM: ${provider}`); } catch (e) { showMessage(`Failed: ${e.message}`, "error"); }
    };
  } catch { sel.innerHTML = '<option value="">Error loading</option>'; }
}

function setupSettingsCheckboxes() {
  const setup = (id, key, fn) => { const cb = $(id); if (cb) { cb.checked = getStateValue(`settings.${key}`); cb.onchange = (e) => fn(e.target.checked, e.target); } };

  setup("require-server-online", "requireServerOnline", (v) => { saveSetting("requireServerOnline", v); refresh(); showMessage(`Server ${v ? "required" : "optional"}`); });

  const apiCb = (key, fn, on, off) => async (v, el) => {
    saveSetting(key, v);
    try { await (await import("../utils/settings-manager.js"))[fn](v); showMessage(v ? on : off); } catch (e) { showMessage(`Failed: ${e.message}`, "error"); el.checked = !v; }
  };
  setup("use-web-search", "useWebSearch", apiCb("useWebSearch", "setWebSearch", "Web search on", "Web search off"));
  setup("use-brave-api", "useBraveApi", apiCb("useBraveApi", "setBraveApi", "Brave API on", "Brave API off"));
}
