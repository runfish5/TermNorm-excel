import { getStateValue, setServerStatus, setServerHost } from "../core/state-actions.js";

export function getHost() {
  return getStateValue('server.host') || "http://127.0.0.1:8000";
}

export function getHeaders() {
  return { "Content-Type": "application/json" };
}

let serverCheckPromise = null;

export async function checkServerStatus() {
  if (serverCheckPromise) {
    return serverCheckPromise;
  }

  serverCheckPromise = (async () => {
    const host = getHost();

    if (!host) {
      setServerStatus(false);
      return;
    }

    try {
      // Note: Uses raw fetch intentionally - this is the foundation for serverFetch()
      // in api-fetch.js, which imports getHost() from here (would cause circular dep)
      const response = await fetch(`${host}/test-connection`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({}),
      });
      const data = await response.json();

      if (response.ok) {
        setServerStatus(true, host, data.data || {});
      } else {
        setServerStatus(false, host);
      }
    } catch (error) {
      setServerStatus(false, host);
    }
  })();

  try {
    await serverCheckPromise;
  } finally {
    serverCheckPromise = null;
  }
}

export function setupServerEvents() {
  const backendUrl = getHost();
  setServerHost(backendUrl);

  const serverUrlInput = document.getElementById("server-url-input");
  if (serverUrlInput) {
    serverUrlInput.addEventListener("input", (e) => {
      setServerHost(e.target.value.trim());
    });
  }
}
