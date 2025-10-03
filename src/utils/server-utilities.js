// utils/server-utilities.js
// Consolidated server configuration and status management
import { state, setStatus } from "../shared-services/state-machine.manager.js";

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

    // Update state directly
    state.server.online = isOnline;
    state.server.host = host;
    state.server.info = serverInfo;

    // Notify server state change
    updateServerUI(state.server);

    // Simple status messages
    if (isOnline) {
      setStatus("Server online");
    } else if (testResponse.status === 403) {
      // Server is online but authentication failed
      const errorData = await testResponse.json().catch(() => ({}));
      setStatus(`❌ Authentication failed: ${errorData.message || 'IP not authorized'}`, true);
    } else {
      setStatus("Server connection failed", true);
    }
  } catch (error) {
    state.server.online = false;
    state.server.host = host;
    state.server.info = {};
    updateServerUI(state.server);
    setStatus(`❌ Server offline: ${error.message}`, true);
  } finally {
    isCheckingServer = false;
  }
}

export function updateServerUI(server) {
  // Update LED status indicator
  const led = document.getElementById("server-status-led");
  if (led) {
    led.className = `status-led ${server.online ? "online" : "offline"}`;

    const status = server.online ? "Online" : "Offline";
    const serverInfo = server.info || {};

    led.title =
      server.online && serverInfo.connectionType && serverInfo.connectionUrl
        ? `${serverInfo.connectionType}\n${serverInfo.connectionUrl}\nStatus: ${status}\nClick to refresh`
        : `Server: ${server.host || "Unknown"}\nStatus: ${status}\nClick to refresh`;
  }

  // Update cloud indicator
  const cloudIndicator = document.getElementById("cloud-indicator");
  if (cloudIndicator) {
    const isCloudAPI = server.info?.connectionType === "Cloud API";
    cloudIndicator.classList.toggle("hidden", !isCloudAPI);
  }
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
