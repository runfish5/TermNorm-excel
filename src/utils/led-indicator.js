// led-indicator.js - Server status LED indicator
import { state } from "../shared-services/state-machine.manager.js";

export function updateLED() {
  const led = document.getElementById("server-status-led");
  if (!led) return;

  led.className = state.server.online ? "status-led green" : "status-led red";
  led.title = state.server.online ? "Server: Online" : "Server: Offline";
}

export function setupLED() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#server-status-led")) {
      e.preventDefault();
      import("./server-utilities.js").then(m => m.checkServerStatus());
    }
  });
}
