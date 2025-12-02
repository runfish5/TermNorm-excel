import { getStateValue } from "../core/state-actions.js";

export function updateLED() {
  const led = document.getElementById("server-status-led");
  const textElement = document.getElementById("server-status-text");
  if (!led) return;

  const isOnline = getStateValue('server.online');
  led.className = isOnline ? "led led-success" : "led led-error";
  led.title = "Click to refresh";

  if (textElement) {
    textElement.textContent = isOnline ? "Online" : "Offline";
  }
}

export function setupLED() {
  document.addEventListener("click", (e) => {
    if (e.target.closest("#server-status-led")) {
      e.preventDefault();
      import("./server-utilities.js").then((m) => m.checkServerStatus());
    }
  });
}
