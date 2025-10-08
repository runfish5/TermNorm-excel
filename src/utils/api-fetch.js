// utils/api-fetch.js
import { showError, showSuccess, showProcessing } from "./error-display.js";
import { state } from "../shared-services/state-machine.manager.js";

/**
 * Smart fetch wrapper - handles ALL complexity
 * - Updates LED to green immediately (shows server is being contacted)
 * - Parses JSON automatically
 * - Handles errors automatically
 * - Returns clean data or null
 *
 * @param {string} url - Full URL to fetch
 * @param {Object} options - Fetch options (method, body, headers, silent, etc.)
 * @returns {Promise<Object|null>} - Response data or null on error
 */
export async function apiFetch(url, options = {}) {
  // Show processing state immediately - LED turns green NOW (unless silent mode)
  if (!options.silent) {
    showProcessing(options.processingMessage || "Processing...");
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    state.server.online = true;
    state.server.lastChecked = Date.now();

    if (response.ok) {
      showSuccess(data.message || "Operation successful");
      return data.data ?? null;
    }

    showError(response.status, data.message || data.detail);
    return null;

  } catch (error) {
    state.server.online = false;
    state.server.lastChecked = Date.now();

    showError(0, "Server offline - Check backend is running on port 8000");
    return null;
  }
}

/**
 * Convenience wrapper for POST requests with JSON body
 */
export async function apiPost(url, body, headers = {}, extraOptions = {}) {
  return apiFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body),
    ...extraOptions
  });
}

/**
 * Convenience wrapper for GET requests
 */
export async function apiGet(url, headers = {}) {
  return apiFetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...headers
    }
  });
}
