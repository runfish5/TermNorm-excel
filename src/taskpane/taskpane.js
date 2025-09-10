import { startTracking } from "../services/live.tracker.js";
import { renewPrompt } from "../services/aiPromptRenewer.js";
import { init as initActivityFeed, updateHistoryTabCounter } from "../ui-components/ActivityFeedUI.js";
import { setupServerEvents, checkServerStatus } from "../utils/server-utilities.js";
import { state, setStatus, onStatusChange } from "../shared-services/state.manager.js";
import { initializeVersionDisplay, updateContentMargin } from "../utils/app-utilities.js";
import { getApiKey } from "../utils/server-utilities.js";
import { showView } from "../ui-components/view-manager.js";
import { setupFileHandling, loadStaticConfig } from "../ui-components/file-handling.js";

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
  document.getElementById("show-metadata-btn")?.addEventListener("click", () => {
    const content = document.getElementById("metadata-content");
    content &&
      (content.classList.toggle("hidden")
        ? (document.getElementById("show-metadata-btn").textContent = "Show Processing Details")
        : (document.getElementById("show-metadata-btn").textContent = "Hide Processing Details"));
  });

  document.getElementById("setup-map-tracking")?.addEventListener("click", async (e) => {
    if (!getApiKey()?.trim())
      return setStatus("API key is required to activate tracking. Please set your API key in Settings.", true);
    e.target.disabled = true;
    e.target.textContent = "Activating...";
    try {
      await startLiveTracking();
    } catch (error) {
      setStatus(`Activation failed: ${error.message}`, true);
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

  onStatusChange((ui) => {
    const statusElement = document.getElementById("main-status-message");
    (statusElement &&
      ((statusElement.textContent = ui.statusMessage), (statusElement.style.color = ui.isError ? "#D83B01" : ""))) ||
      console.warn("Status element not found:", ui.statusMessage);
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
    setStatus(`Initialization failed: ${error.message}`, true);
  }
});

async function startLiveTracking() {
  const config = state.config.data;
  const mappings = state.mappings;

  if (!config || (!mappings.forward && !mappings.reverse)) return setStatus("Error: Config or mappings missing", true);

  try {
    await startTracking(config, mappings);
    setStatus("Tracking active");
    showView("results");
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

async function renewPromptHandler() {
  const config = state.config.data;
  if (!config) return setStatus("Config not loaded", true);

  const mappings = state.mappings;
  await renewPrompt(mappings, config, (msg, isError) => setStatus(msg, isError));
}
