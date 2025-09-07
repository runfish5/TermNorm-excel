// utils/server-utilities.js
// Consolidated server configuration and status management
import { state } from "../shared-services/state.manager.js";

// Server configuration functions
export function getHost() {
  return state.get("server.host") || "http://127.0.0.1:8000";
}

export function getApiKey() {
  return state.get("server.apiKey");
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

  try {
    const headers = getHeaders();
    
    // Single endpoint test with timeout
    const testResponse = await fetch(`${host}/test-connection`, {
      method: "POST",
      headers: headers,
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5000),
    });

    const isOnline = testResponse.ok;
    let serverInfo = {};

    if (isOnline) {
      const data = await testResponse.json();
      serverInfo = {
        connectionType: data.connection_type || "Backend API",
        connectionUrl: data.connection_url || host,
        environment: data.environment || "development",
      };
    }

    // Update state
    state.update({
      "server.online": isOnline,
      "server.host": host,
      "server.info": serverInfo,
    });

    // Simple status messages
    if (isOnline) {
      state.setStatus("Server online");
    } else {
      state.setStatus("Server connection failed", true);
    }
  } catch (error) {
    state.update({
      "server.online": false,
      "server.host": host,
      "server.info": {},
    });
    state.setStatus(`Connection error: ${error.message}`, true);
  } finally {
    isCheckingServer = false;
  }
}

export function updateServerUI(server) {
  updateServerLED(server.online, server.host);
  updateCloudIndicator(server.info);
}

function updateServerLED(isOnline, host) {
  const led = document.getElementById("server-status-led");
  if (!led) return;

  led.className = `status-led ${isOnline ? "online" : "offline"}`;
  
  const status = isOnline ? "Online" : "Offline";
  const serverInfo = state.get("server.info") || {};
  
  const tooltipText = isOnline && serverInfo.connectionType && serverInfo.connectionUrl
    ? `${serverInfo.connectionType}\n${serverInfo.connectionUrl}\nStatus: ${status}\nClick to refresh`
    : `Server: ${host || "Unknown"}\nStatus: ${status}\nClick to refresh`;

  led.title = tooltipText;
}

function updateCloudIndicator(serverInfo) {
  const cloudIndicator = document.getElementById("cloud-indicator");
  if (!cloudIndicator) return;

  const isCloudAPI = serverInfo?.connectionType === "Cloud API";
  cloudIndicator.classList.toggle("hidden", !isCloudAPI);
}

export function setupServerEvents() {
  // Set initial server host
  const backendUrl = getHost();
  state.set("server.host", backendUrl);

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
      state.set("server.apiKey", e.target.value.trim());
    });
  }

  // Server URL input
  const serverUrlInput = document.getElementById("server-url-input");
  if (serverUrlInput) {
    serverUrlInput.addEventListener("input", (e) => {
      state.set("server.host", e.target.value.trim());
    });
  }

  // Subscribe to server state changes
  state.subscribe("server", updateServerUI);
}