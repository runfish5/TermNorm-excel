import { showMessage } from "./error-display.js";
import { state } from "../shared-services/state-machine.manager.js";

export async function apiFetch(url, options = {}) {
  showMessage(options.processingMessage || "Processing...");

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    state.server.online = true;
    state.server.lastChecked = Date.now();

    if (response.ok) {
      showMessage(data.message || "Operation successful");
      return data.data ?? null;
    }

    showMessage(data.message || data.detail, "error");
    return null;

  } catch (error) {
    state.server.online = false;
    state.server.lastChecked = Date.now();

    showMessage("Server offline - Check backend is running on port 8000", "error");
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
