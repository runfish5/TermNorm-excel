/** API Client - HTTP operations and server connectivity */
import { showMessage } from "./ui-feedback.js";
import { getStateValue, setServerStatus, setServerHost } from "../core/state-actions.js";
import { ERROR_GUIDANCE, ENDPOINTS } from "../config/config.js";
import { $ } from "./dom-helpers.js";

// Server utilities
export function getHost() { return getStateValue('server.host') || "http://127.0.0.1:8000"; }
export function getHeaders() { return { "Content-Type": "application/json" }; }
export const buildUrl = endpoint => `${getHost()}${endpoint}`;

let serverCheckPromise = null;
export async function checkServerStatus() {
  if (serverCheckPromise) return serverCheckPromise;
  serverCheckPromise = (async () => {
    const host = getHost();
    if (!host) return setServerStatus(false);
    try {
      const response = await fetch(`${host}${ENDPOINTS.HEALTH}`, { method: "GET", headers: getHeaders() });
      const data = await response.json();
      setServerStatus(response.ok, host, response.ok ? data.data || {} : {});
    } catch { setServerStatus(false, host); }
  })();
  try { await serverCheckPromise; } finally { serverCheckPromise = null; }
}

export function setupServerEvents() {
  setServerHost(getHost());
  $("server-url-input")?.addEventListener("input", (e) => setServerHost(e.target.value.trim()));
}

// Fetch wrappers
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

// HTTP method wrappers
export const apiPost = (url, body, headers = {}, opts = {}) => apiFetch(url, { method: "POST", headers: { ...getHeaders(), ...headers }, body: JSON.stringify(body), ...opts });
export const apiGet = (url, headers = {}, silent = false) => apiFetch(url, { method: "GET", headers: { ...getHeaders(), ...headers }, silent });
export const apiPut = (url, body, opts = {}) => apiFetch(url, { method: "PUT", headers: getHeaders(), body: JSON.stringify(body), ...opts });
export const fireAndForget = p => p.catch(() => {});
export const logMatch = (data, h = {}) => fireAndForget(serverFetch(buildUrl(ENDPOINTS.ACTIVITY_MATCHES), { method: "POST", headers: { ...getHeaders(), ...h }, body: JSON.stringify(data) }));
