import { getStateValue, setServerStatus, setServerHost } from "../core/state-actions.js";

export function getHost() { return getStateValue('server.host') || "http://127.0.0.1:8000"; }
export function getHeaders() { return { "Content-Type": "application/json" }; }

let serverCheckPromise = null;

export async function checkServerStatus() {
  if (serverCheckPromise) return serverCheckPromise;
  serverCheckPromise = (async () => {
    const host = getHost();
    if (!host) return setServerStatus(false);
    try {
      const response = await fetch(`${host}/test-connection`, { method: "POST", headers: getHeaders(), body: "{}" });
      const data = await response.json();
      setServerStatus(response.ok, host, response.ok ? data.data || {} : {});
    } catch { setServerStatus(false, host); }
  })();
  try { await serverCheckPromise; } finally { serverCheckPromise = null; }
}

export function setupServerEvents() {
  setServerHost(getHost());
  document.getElementById("server-url-input")?.addEventListener("input", (e) => setServerHost(e.target.value.trim()));
}
