// utils/api-fetch.js
// CENTRALIZED API COMMUNICATION - All fetch() calls go through here

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
 * @param {Object} options - Fetch options (method, body, headers, etc.)
 * @returns {Promise<Object|null>} - Response data or null on error
 */
export async function apiFetch(url, options = {}) {
  // Show processing state immediately - LED turns green NOW
  showProcessing(options.processingMessage || "Processing...");

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    // Update server status - server responded (even if error)
    state.server.online = true;
    state.server.lastChecked = Date.now();

    if (response.ok) {
      // Success
      showSuccess(data.message || "Operation successful");
      return data.data ?? null;
    }

    // HTTP error but server is up
    showError(response.status, data.message || data.detail);
    return null;

  } catch (error) {
    // Network error - server offline
    state.server.online = false;
    state.server.lastChecked = Date.now();

    showError(0, "Server offline - Check backend is running on port 8000");
    return null;
  }
}

/**
 * Convenience wrapper for POST requests with JSON body
 */
export async function apiPost(url, body, headers = {}) {
  return apiFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
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
