import { getStateValue } from "../core/state-actions.js";

export function updateWarnings() {
  const offlineWarning = document.getElementById("offline-mode-warning");
  if (offlineWarning) offlineWarning.classList.toggle("hidden", getStateValue('settings.requireServerOnline') !== false);

  const webWarning = document.getElementById("web-search-warning");
  if (webWarning) {
    const failed = getStateValue('webSearch.status') === "failed";
    webWarning.classList.toggle("hidden", !failed);
    if (failed) webWarning.title = `Web scraping failed: ${getStateValue('webSearch.error') || "Unknown error"}`;
  }
}
