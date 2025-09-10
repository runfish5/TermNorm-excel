// utils/server-utilities.js
// Consolidated server configuration and status management
import { state, setStatus } from "../shared-services/state.manager.js";

/**
 * Parse HTTP response into standardized result object
 * Follows OpenAPI/REST client library conventions
 * @param {Response} response - Fetch API Response object
 * @returns {ApiResult} Standardized result with success/error state
 */
export function parseResponse(response) {
  return {
    success: response.ok,
    status: response.status,
    statusText: response.statusText,
    error: response.ok ? null : {
      message: getStatusMessage(response.status),
      category: getErrorCategory(response.status),
      retryable: isRetryable(response.status)
    }
  };
}

export function getStatusMessage(status) {
  switch (status) {
    case 401: return "❌[401] API key invalid - check your key";
    case 403: return "🚫[403] Server returned 403 - IP may be blocked or access denied";
    case 503: return "⚠️[503] Server restart detected - mapping indexes lost. Please reload your configuration files to restore mapping data";
    case 429: return "⏳[429] Rate limit exceeded - please wait before retrying";
    case 408: return "⏱️[408] Request timeout - server took too long to respond";
    case 502: return "🔧[502] Bad gateway - server configuration issue";
    case 504: return "⏱️[504] Gateway timeout - upstream server not responding";
    default:
      if (status >= 500) return `🔧 Server error: ${status}`;
      if (status >= 400) return `❌ Client error: ${status}`;
      return `❌ HTTP error: ${status}`;
  }
}

function getErrorCategory(status) {
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if (status >= 400 && status < 500) return 'client';
  if (status >= 500) return 'server';
  return 'network';
}

function isRetryable(status) {
  return status >= 500 || status === 429 || status === 408 || status === 502 || status === 504;
}

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

    const result = parseResponse(testResponse);
    let serverInfo = {};

    if (result.success) {
      const data = await testResponse.json();
      serverInfo = {
        connectionType: data.connection_type || "Backend API",
        connectionUrl: data.connection_url || host,
        environment: data.environment || "development",
      };
    }

    // Update state directly
    state.server.online = result.success;
    state.server.host = host;
    state.server.info = serverInfo;

    // Notify server state change
    updateServerUI(state.server);

    // Simple status messages
    if (result.success) {
      setStatus("Server online");
    } else {
      setStatus(result.error.message, true);
    }
  } catch (error) {
    state.server.online = false;
    state.server.host = host;
    state.server.info = {};
    updateServerUI(state.server);
    setStatus(`Connection error: ${error.message}`, true);
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
