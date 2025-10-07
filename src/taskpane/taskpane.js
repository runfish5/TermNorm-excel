import { startTracking } from "../services/live.tracker.js";
import { renewPrompt } from "../services/aiPromptRenewer.js";
import { init as initActivityFeed, updateHistoryTabCounter } from "../ui-components/ActivityFeedUI.js";
import { setupServerEvents, checkServerStatus } from "../utils/server-utilities.js";
import { state, onStateChange } from "../shared-services/state-machine.manager.js";
import { initializeVersionDisplay, initializeProjectPathDisplay, updateContentMargin } from "../utils/app-utilities.js";
import { showView } from "../ui-components/view-manager.js";
import { setupFileHandling, loadStaticConfig } from "../ui-components/file-handling.js";
import { showStatus } from "../utils/error-display.js";

Office.onReady(async (info) => {
  if (info.host !== Office.HostType.Excel) {
    document.getElementById("sideload-msg").textContent = "This add-in requires Microsoft Excel";
    return;
  }

  document.body.className = "ms-font-m ms-welcome ms-Fabric";

  initActivityFeed();
  updateHistoryTabCounter();

  const [sideloadMsg, appBody] = ["sideload-msg", "app-body"].map((id) => document.getElementById(id));
  sideloadMsg.style.display = "none";
  appBody.style.display = "flex";

  setupFileHandling();
  setupServerEvents();
  checkServerStatus();
  initializeVersionDisplay();
  initializeProjectPathDisplay();
  document.getElementById("show-metadata-btn")?.addEventListener("click", () => {
    const content = document.getElementById("metadata-content");
    content &&
      (content.classList.toggle("hidden")
        ? (document.getElementById("show-metadata-btn").textContent = "Show Processing Details")
        : (document.getElementById("show-metadata-btn").textContent = "Hide Processing Details"));
  });

  document.getElementById("setup-map-tracking")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Activating...";
    try {
      await startLiveTracking();
    } catch (error) {
      showStatus(`Activation failed: ${error.message}`, true);
    } finally {
      e.target.disabled = false;
      e.target.textContent = "Activate Tracking";
    }
  });

  document.getElementById("renew-prompt")?.addEventListener("click", () => renewPromptHandler());

  document.addEventListener("click", (e) => {
    const navTab = e.target.closest(".nav-tab");
    if (navTab) {
      e.preventDefault();
      showView(navTab.getAttribute("data-view"));
    }
  });

  onStateChange((newState) => {
    // Log state changes for debugging
    console.log("State changed:", {
      mappingsLoaded: newState.mappings.loaded,
      sourceCount: Object.keys(newState.mappings.sources).length,
      syncedCount: Object.values(newState.mappings.sources).filter((s) => s.status === "synced").length,
    });
  });

  window.showView = showView;

  updateContentMargin();
  const statusMessage = document.getElementById("main-status-message");
  if (statusMessage) {
    const observer = new MutationObserver(updateContentMargin);
    observer.observe(statusMessage, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  window.addEventListener("resize", updateContentMargin);
  try {
    await loadStaticConfig();
    Object.assign(window, { state, mappingModules: [] });
  } catch (error) {
    console.error("Failed to initialize:", error);
    showStatus(`Initialization failed: ${error.message}`, true);
  }
});

async function startLiveTracking() {
  const config = state.config.data;
  const mappings = state.mappings.combined;

  // Validation: Config and mappings
  if (!config || !mappings || (!mappings.forward && !mappings.reverse)) {
    return showStatus("Error: Config or mappings missing - load configuration first", true);
  }

  // Validation: Server online (for LLM features)
  if (!state.server.online) {
    return showStatus("Warning: Server offline - only exact/fuzzy matching will work", false);
  }

  try {
    const termCount = Object.keys(mappings.reverse || {}).length;
    await startTracking(config, mappings);
    showStatus(`✅ Tracking active with ${termCount} terms (exact/fuzzy/LLM matching enabled)`);
    showView("results");
  } catch (error) {
    showStatus(`Error: ${error.message}`, true);
  }
}

async function renewPromptHandler() {
  const config = state.config.data;
  if (!config) return showStatus("Config not loaded", true);

  const mappings = state.mappings.combined;
  await renewPrompt(mappings, config, (msg, isError) => showStatus(msg, isError));
}
