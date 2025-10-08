import { state } from "../shared-services/state-machine.manager.js";
import { updateOfflineModeWarning } from "./offline-warning.js";

export function updateLED() {
  const led = document.getElementById("server-status-led");
  const textElement = document.getElementById("server-status-text");
  if (!led) return;

  led.className = state.server.online ? "status-led green" : "status-led red";
  led.title = "Click to refresh";

  if (textElement) {
    textElement.textContent = state.server.online ? "Online" : "Offline";
  }

  updateOfflineModeWarning();
}

export function setupLED() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#server-status-led")) {
      e.preventDefault();
      import("./server-utilities.js").then(m => m.checkServerStatus());
    }
  });
}
