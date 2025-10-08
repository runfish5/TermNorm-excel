// utils/server-utilities.js
import { state } from "../shared-services/state-machine.manager.js";
import { apiPost } from "./api-fetch.js";

export function getHost() {
  return state.server.host || "http://127.0.0.1:8000";
}

export function getHeaders() {
  return { "Content-Type": "application/json" };
}

let isCheckingServer = false;

export async function checkServerStatus() {
  if (isCheckingServer) return;

  isCheckingServer = true;
  const host = getHost();

  if (!host) {
    isCheckingServer = false;
    return;
  }

  const data = await apiPost(`${host}/test-connection`, {}, getHeaders(), { silent: true });

  if (data) {
    state.server.online = true;
    state.server.host = host;
    state.server.info = data || {};
  } else {
    state.server.online = false;
    state.server.host = host;
    state.server.info = {};
  }

  isCheckingServer = false;
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
