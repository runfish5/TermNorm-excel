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
  const msg = (status in ERROR_MAP) ? ERROR_MAP[status] : (message || "Unknown error");

  let ledColor;
  if (!status || status >= 500) {
    ledColor = "red";
  } else if (status >= 400) {
    ledColor = "yellow";
  } else {
    ledColor = "green";
  }

  const statusEl = document.getElementById("main-status-message");
  if (statusEl) {
    statusEl.textContent = msg;
    statusEl.style.color = "#D83B01";
  }

  const led = document.getElementById("server-status-led");
  if (led) {
    led.className = `status-led ${ledColor}`;
  }
}

export function showSuccess(message) {
  const statusEl = document.getElementById("main-status-message");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = "";
  }

  const led = document.getElementById("server-status-led");
  if (led) {
    led.className = "status-led green";
  }
}

export function showProcessing(message = "Processing...") {
  const statusEl = document.getElementById("main-status-message");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = "";
  }

  const led = document.getElementById("server-status-led");
  if (led) {
    led.className = "status-led green";
  }
}

export function showStatus(message, isError = false) {
  const statusEl = document.getElementById("main-status-message");
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#D83B01" : "";
  }
}
