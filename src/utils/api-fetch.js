import { showMessage } from "./error-display.js";
import { state } from "../shared-services/state-machine.manager.js";
import { getHost } from "./server-utilities.js";
import { ERROR_GUIDANCE } from "../config/session.config.js";

/**
 * Generic API fetch with error handling and state management
 *
 * @param {string} url - API endpoint URL (relative or absolute)
 * @param {Object} options - Fetch options
 * @param {boolean} [options.silent] - If true, suppress UI messages
 * @param {string} [options.processingMessage] - Custom processing message
 * @returns {Promise<any>} Response data or null on error
 */
export async function apiFetch(url, options = {}) {
  const silent = options.silent;
  delete options.silent; // Remove before fetch

  if (!silent) showMessage(options.processingMessage || "Processing...", "processing");

  // Handle relative vs absolute URLs
  const fullUrl = url.startsWith("http") ? url : `${getHost()}${url}`;

  try {
    const response = await fetch(fullUrl, options);
    const data = await response.json();

    state.server.online = true;
    state.server.lastChecked = Date.now();

    if (response.ok) {
      if (!silent) showMessage(data.message || "Operation successful");
      return data.data ?? null;
    }

    // Handle different error types with specific guidance
    if (!silent) {
      const errorMessage = buildErrorMessage(response.status, data);
      showMessage(errorMessage, "error");
    }
    return null;

  } catch (error) {
    state.server.online = false;
    state.server.lastChecked = Date.now();

    if (!silent) {
      const errorMessage = `Server offline - Check backend is running on port 8000\n\n${ERROR_GUIDANCE.OFFLINE}`;
      showMessage(errorMessage, "error");
    }
    return null;
  }
}

/**
 * Build error message with troubleshooting guidance based on status code
 *
 * @param {number} statusCode - HTTP status code
 * @param {Object} data - Response data containing error details
 * @returns {string} Formatted error message with guidance
 */
function buildErrorMessage(statusCode, data) {
  let errorMessage = data.message || data.detail || "Request failed";

  // Get guidance for this error type
  const guidance = getErrorGuidance(statusCode, errorMessage);
  if (guidance) {
    errorMessage += `\n\n${guidance}`;
  }

  return errorMessage;
}

/**
 * Get troubleshooting guidance for error status code
 *
 * @param {number} statusCode - HTTP status code
 * @param {string} errorMessage - Error message text
 * @returns {string|null} Guidance text or null
 */
function getErrorGuidance(statusCode, errorMessage) {
  // Check for session-specific errors first
  if (statusCode === 400 && errorMessage.includes("No session found")) {
    return ERROR_GUIDANCE.SESSION_LOST;
  }

  // Return guidance for status code
  return ERROR_GUIDANCE[statusCode] || null;
}

/**
 * Convenience wrapper for POST requests with JSON body
 *
 * @param {string} url - API endpoint URL
 * @param {Object} body - Request body to be JSON stringified
 * @param {Object} [headers={}] - Additional headers
 * @param {Object} [extraOptions={}] - Additional fetch options (e.g., silent: true)
 * @returns {Promise<any>} Response data or null on error
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
 *
 * @param {string} url - API endpoint URL
 * @param {Object} [headers={}] - Additional headers
 * @param {boolean} [silent=false] - If true, suppress UI messages
 * @returns {Promise<any>} Response data or null on error
 */
export async function apiGet(url, headers = {}, silent = false) {
  return apiFetch(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    silent
  });
}
