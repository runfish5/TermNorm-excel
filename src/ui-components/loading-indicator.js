/**
 * Loading Indicator Component
 * Provides an animated sandclock/hourglass indicator for processing states
 */

let loadingIndicatorElement = null;

/**
 * Initialize the loading indicator element
 * @returns {HTMLElement} The loading indicator element
 */
function getLoadingIndicatorElement() {
  if (!loadingIndicatorElement) {
    loadingIndicatorElement = document.getElementById("loading-indicator");
  }
  return loadingIndicatorElement;
}

/**
 * Show the animated loading indicator with a message
 * @param {string} message - The message to display (default: "Processing...")
 */
export function showLoadingIndicator(message = "Processing...") {
  const indicator = getLoadingIndicatorElement();
  if (!indicator) return;

  indicator.innerHTML = `
    <div class="sandclock-container">
      <span class="loading-message">${message}</span>
      <span class="hourglass-emoji">⏳</span>
    </div>
  `;

  indicator.classList.add("visible");
}

/**
 * Hide the loading indicator
 */
export function hideLoadingIndicator() {
  const indicator = getLoadingIndicatorElement();
  if (!indicator) return;

  indicator.classList.remove("visible");

  // Clear content after transition completes
  setTimeout(() => {
    if (!indicator.classList.contains("visible")) {
      indicator.innerHTML = "";
    }
  }, 300);
}
