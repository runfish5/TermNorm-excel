import { state } from "../shared-services/state-machine.manager.js";

/**
 * Warning Manager - Centralized Warning Badge Control
 *
 * Manages visibility and content of warning badges based on application state.
 * Called automatically via onStateChange callback for state-driven updates.
 *
 * Warning Types:
 * 1. Offline Mode Warning - Shows when offline mode is enabled (requireServerOnline = false)
 * 2. Web Search Warning - Shows when web scraping fails, clears on new requests
 */

/**
 * Update all warning badges based on current state
 * Pure function: state → DOM updates
 */
export function updateWarnings() {
  updateOfflineModeWarning();
  updateWebSearchWarning();
}

/**
 * Update offline mode warning visibility
 * Shows when user has enabled offline mode in settings
 */
function updateOfflineModeWarning() {
  const warning = document.getElementById("offline-mode-warning");
  if (!warning) return;

  // Show warning when offline mode is enabled (server not required)
  if (state.settings?.requireServerOnline === false) {
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }
}

/**
 * Update web search warning visibility
 * Shows when last web search failed, clears on new requests (status = "idle")
 */
function updateWebSearchWarning() {
  const warning = document.getElementById("web-search-warning");
  if (!warning) return;

  if (state.webSearch?.status === "failed") {
    warning.classList.remove("hidden");
    const errorMsg = state.webSearch?.error || "Unknown error";
    warning.title = `Web scraping failed: ${errorMsg}`;
  } else {
    // Hide on success or idle (new request started)
    warning.classList.add("hidden");
  }
}
