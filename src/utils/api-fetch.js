import { showMessage } from "./error-display.js";
import { setServerStatus } from "../core/state-actions.js";
import { getHost } from "./server-utilities.js";
import { ERROR_GUIDANCE } from "../config/session.config.js";

/** Server-aware fetch - updates server status LED on success/failure */
export async function serverFetch(url, options = {}) {
  const fullUrl = url.startsWith("http") ? url : `${getHost()}${url}`;
  try {
    const response = await fetch(fullUrl, options);
    setServerStatus(true);
    return response;
  } catch (error) {
    if (error.name !== "AbortError") setServerStatus(false);
    throw error;
  }
}

/** Generic API fetch with error handling */
async function apiFetch(url, options = {}) {
  const { silent, processingMessage, ...fetchOpts } = options;
  if (!silent) showMessage(processingMessage || "Processing...", "processing");

  try {
    const response = await serverFetch(url, fetchOpts);
    const data = await response.json();

    if (response.ok) {
      if (!silent) showMessage(data.message || "Operation successful");
      return data.data ?? null;
    }

    if (!silent) {
      const msg = data.message || data.detail || "Request failed";
      const guidance = (response.status === 400 && msg.includes("No session found"))
        ? ERROR_GUIDANCE.SESSION_LOST
        : ERROR_GUIDANCE[response.status];
      showMessage(guidance ? `${msg}\n\n${guidance}` : msg, "error");
    }
    return null;
  } catch {
    if (!silent) showMessage(`Server offline - Check backend is running on port 8000\n\n${ERROR_GUIDANCE.OFFLINE}`, "error");
    return null;
  }
}

/** POST request with JSON body */
export async function apiPost(url, body, headers = {}, extraOptions = {}) {
  return apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    ...extraOptions,
  });
}

/** GET request */
export async function apiGet(url, headers = {}, silent = false) {
  return apiFetch(url, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...headers },
    silent,
  });
}
