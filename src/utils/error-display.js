/** Error/Status Display with Loading Indicator */

let loadingIndicator = null;

function getLoadingIndicator() {
  if (!loadingIndicator) loadingIndicator = document.getElementById("loading-indicator");
  return loadingIndicator;
}

function showLoadingIndicator(message = "Processing...") {
  const indicator = getLoadingIndicator();
  if (!indicator) return;
  indicator.innerHTML = `<div class="sandclock-container"><span class="loading-message">${message}</span><span class="hourglass-emoji">⏳</span></div>`;
  indicator.classList.add("visible");
}

function hideLoadingIndicator() {
  const indicator = getLoadingIndicator();
  if (!indicator) return;
  indicator.classList.remove("visible");
  setTimeout(() => { if (!indicator.classList.contains("visible")) indicator.innerHTML = ""; }, 300);
}

export function showMessage(text, type = "info") {
  if (type === "processing" || text.toLowerCase().includes("processing")) {
    showLoadingIndicator(text);
    return;
  }

  hideLoadingIndicator();

  const el = document.getElementById("main-status-message");
  if (!el) return;
  el.textContent = text;
  el.style.color = type === "error" ? "#F44336" : "";
}
