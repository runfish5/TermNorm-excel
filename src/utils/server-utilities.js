import { state, notifyStateChange } from "../shared-services/state-machine.manager.js";

export function getHost() {
  return state.server.host || "http://127.0.0.1:8000";
}

export function getHeaders() {
  return { "Content-Type": "application/json" };
}

let serverCheckPromise = null;
let onServerReconnectedHandler = null;

/**
 * Register a handler to be called when server transitions from offline → online
 * @param {Function} handler - Async function to call on reconnection
 */
export function onServerReconnected(handler) {
  onServerReconnectedHandler = handler;
}

export async function checkServerStatus() {
  if (serverCheckPromise) {
    return serverCheckPromise;
  }

  serverCheckPromise = (async () => {
    const host = getHost();
    const wasOffline = !state.server.online;

    if (!host) {
      state.server.online = false;
      notifyStateChange();
      return;
    }

    try {
      const response = await fetch(`${host}/test-connection`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({}),
      });
      const data = await response.json();

      if (response.ok) {
        state.server.online = true;
        state.server.host = host;
        state.server.info = data.data || {};

        // Trigger reconnection handler if transitioning from offline → online
        if (wasOffline && onServerReconnectedHandler) {
          onServerReconnectedHandler();
        }
      } else {
        state.server.online = false;
        state.server.host = host;
        state.server.info = {};
      }
    } catch (error) {
      state.server.online = false;
      state.server.host = host;
      state.server.info = {};
    }

    notifyStateChange();
  })();

  try {
    await serverCheckPromise;
  } finally {
    serverCheckPromise = null;
  }
}

export function setupServerEvents() {
  const backendUrl = getHost();
  state.server.host = backendUrl;

  const serverUrlInput = document.getElementById("server-url-input");
  if (serverUrlInput) {
    serverUrlInput.addEventListener("input", (e) => {
      state.server.host = e.target.value.trim();
    });
  }
}
