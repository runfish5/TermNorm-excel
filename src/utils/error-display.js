// utils/error-display.js
// BACKBONE: All UI updates go through here

// ============================================
// CONFIGURATION - Only place to customize
// ============================================

// Custom messages for specific HTTP status codes
const ERROR_MAP = {
  403: "IP not authorized - Check backend users.json",
  503: "Service unavailable - Reload mapping tables"
};

// ============================================
// PUBLIC API - Called by api-fetch.js
// ============================================

/**
 * Show error - Now takes status code and message directly
 * @param {number} status - HTTP status code (0 = network error)
 * @param {string} message - Error message from backend
 */
export function showError(status, message) {
  // Prefer backend message, use ERROR_MAP only as fallback
  const msg = (status in ERROR_MAP) ? ERROR_MAP[status] : (message || "Unknown error");

  // Determine LED color based on error type
  let ledColor;
  if (!status || status >= 500) {
    ledColor = "red";    // Network errors or 5xx server errors
  } else if (status >= 400) {
    ledColor = "yellow"; // 4xx client errors (auth, not found, etc.)
  } else {
    ledColor = "green";  // 2xx success
  }

  updateUI(msg, true, ledColor);
}

/**
 * Show success message
 */
export function showSuccess(message) {
  updateUI(message, false, "green");
}

/**
 * Show processing state (LED turns green immediately)
 */
export function showProcessing(message = "Processing...") {
  updateUI(message, false, "green");
}

// ============================================
// PRIVATE - DOM manipulation
// ============================================

function updateUI(message, isError, ledColor) {
  const statusEl = document.getElementById("main-status-message");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#D83B01" : "";
  }

  const led = document.getElementById("server-status-led");
  if (led) {
    led.className = `status-led ${ledColor}`;
  }
}
