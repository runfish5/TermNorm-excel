import { showMessage } from "./error-display.js";
import { state } from "../shared-services/state-machine.manager.js";
import { getHost } from "./server-utilities.js";

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
      let errorMessage = data.message || data.detail || "Request failed";

      // Add troubleshooting guidance based on status code
      if (response.status === 403) {
        errorMessage += "\n\n💡 Check your IP is in backend-api/config/users.json";
      } else if (response.status === 500) {
        errorMessage += "\n\n💡 Server error - check backend-api/logs/app.log";
      } else if (response.status === 400 && errorMessage.includes("No session found")) {
        errorMessage += "\n\n💡 Session lost - reload mappings or wait for auto-recovery";
      }

      showMessage(errorMessage, "error");
    }
    return null;

  } catch (error) {
    state.server.online = false;
    state.server.lastChecked = Date.now();

    if (!silent) {
      const errorMessage = "Server offline - Check backend is running on port 8000\n\n💡 Run: start-server-py-LLMs.bat";
      showMessage(errorMessage, "error");
    }
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
