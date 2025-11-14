import { showLoadingIndicator, hideLoadingIndicator } from "../ui-components/loading-indicator.js";

export function showMessage(text, type = "info") {
  // If this is a processing message, use the animated loading indicator
  if (type === "processing" || text.toLowerCase().includes("processing")) {
    showLoadingIndicator(text);
    return;
  }

  // Hide loading indicator if it's visible
  hideLoadingIndicator();

  // Show regular message
  const el = document.getElementById("main-status-message");
  if (!el) return;

  el.textContent = text;
  el.style.color = type === "error" ? "#F44336" : "";
}
