import { showMessage } from "./error-display.js";
import { setServerStatus } from "../core/state-actions.js";
import { getHost } from "./server-utilities.js";
import { ERROR_GUIDANCE } from "../config/session.config.js";

export async function serverFetch(url, options = {}) {
  const fullUrl = url.startsWith("http") ? url : `${getHost()}${url}`;
  try { const r = await fetch(fullUrl, options); setServerStatus(true); return r; }
  catch (e) { if (e.name !== "AbortError") setServerStatus(false); throw e; }
}

async function apiFetch(url, options = {}) {
  const { silent, processingMessage, ...fetchOpts } = options;
  if (!silent) showMessage(processingMessage || "Working", "processing");
  try {
    const response = await serverFetch(url, fetchOpts), data = await response.json();
    if (response.ok) { if (!silent) showMessage(data.message || "Operation successful"); return data.data ?? null; }
    if (!silent) {
      const msg = data.message || data.detail || "Request failed";
      const guidance = (response.status === 400 && msg.includes("No session found")) ? ERROR_GUIDANCE.SESSION_LOST : ERROR_GUIDANCE[response.status];
      showMessage(guidance ? `${msg}\n\n${guidance}` : msg, "error");
    }
    return null;
  } catch { if (!silent) showMessage(`Server offline - Check backend is running on port 8000\n\n${ERROR_GUIDANCE.OFFLINE}`, "error"); return null; }
}

export async function apiPost(url, body, headers = {}, opts = {}) {
  return apiFetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), ...opts });
}

export async function apiGet(url, headers = {}, silent = false) {
  return apiFetch(url, { method: "GET", headers: { "Content-Type": "application/json", ...headers }, silent });
}

/**
 * Fire-and-forget logging for cache/fuzzy matches.
 * Non-blocking - does not wait for response or handle errors.
 */
export function logMatch(data, headers = {}) {
  serverFetch(`${getHost()}/log-match`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data)
  }).catch(() => {});  // Fire-and-forget
}
