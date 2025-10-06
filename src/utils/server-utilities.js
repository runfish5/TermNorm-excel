// utils/server-utilities.js
// Consolidated server configuration and status management
import { state } from "../shared-services/state-machine.manager.js";
import { apiPost } from "./api-fetch.js";

// Server configuration functions
export function getHost() {
  return state.server.host || "http://127.0.0.1:8000";
}

export function getApiKey() {
  return state.server.apiKey;
}

export function getHeaders() {
  const headers = { "Content-Type": "application/json" };
  const apiKey = getApiKey();
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  return headers;
}

// Server status management
let isCheckingServer = false;

export async function checkServerStatus() {
  if (isCheckingServer) return;

  isCheckingServer = true;
  const host = getHost();

  if (!host) {
    isCheckingServer = false;
    return;
  }

  const data = await apiPost(`${host}/test-connection`, {}, getHeaders());

  if (data) {
    // Success
    state.server.online = true;
    state.server.host = host;
    state.server.info = data || {};
  } else {
    // Error (already shown by apiPost)
    state.server.online = false;
    state.server.host = host;
    state.server.info = {};
  }

  isCheckingServer = false;
}

export function setupServerEvents() {
  // Set initial server host
  const backendUrl = getHost();
  state.server.host = backendUrl;

  // LED click to refresh status
  document.addEventListener("click", (e) => {
    if (e.target.closest("#server-status-led")) {
      e.preventDefault();
      checkServerStatus();
    }
  });

  // API key input
  const apiKeyInput = document.getElementById("api-key-input");
  if (apiKeyInput) {
    apiKeyInput.addEventListener("input", (e) => {
      state.server.apiKey = e.target.value.trim();
    });
  }

  // Server URL input
  const serverUrlInput = document.getElementById("server-url-input");
  if (serverUrlInput) {
    serverUrlInput.addEventListener("input", (e) => {
      state.server.host = e.target.value.trim();
    });
  }

  // No longer need subscription - direct updates handled in checkServerStatus
}
