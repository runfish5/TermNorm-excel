import { showMessage } from "./error-display.js";
import { state } from "../shared-services/state-machine.manager.js";
import { getHost } from "./server-utilities.js";

export async function apiFetch(url, options = {}) {
  const silent = options.silent;
  delete options.silent; // Remove before fetch

  if (!silent) showMessage(options.processingMessage || "Processing...");

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

    if (!silent) showMessage(data.message || data.detail, "error");
    return null;

  } catch (error) {
    state.server.online = false;
    state.server.lastChecked = Date.now();

    if (!silent) showMessage("Server offline - Check backend is running on port 8000", "error");
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
