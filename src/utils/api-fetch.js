// utils/api-fetch.js
// CENTRALIZED API COMMUNICATION - All fetch() calls go through here

import { showError, showSuccess, showProcessing } from "./error-display.js";

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
    const response = await fetch(url, {
      signal: AbortSignal.timeout(options.timeout || 30000),
      ...options
    });

    // Parse JSON
    const data = await response.json();

    // Success case
    if (response.ok) {
      showSuccess(data.message || "Operation successful");
      return data.data || data;
    }

    // Error case - pass status code and message to error handler
    showError(response.status, data.message || data.detail);
    return null;

  } catch (error) {
    // Network error - no status code (server offline, timeout, etc.)
    showError(0, error.message);
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
