import { state } from "../shared-services/state-machine.manager.js";

/**
 * Update offline mode warning visibility based on settings
 */
export function updateOfflineModeWarning() {
  const warning = document.getElementById("offline-mode-warning");
  if (!warning) return;

  if (state.settings?.requireServerOnline === false) {
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }
}
