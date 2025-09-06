import { getHost, getHeaders, getApiKey } from "../utils/serverConfig.js";
import { state } from "../shared-services/state.manager.js";

class ServerStatusManager {
  constructor() {
    this.isCheckingServer = false;
  }

  initialize() {
    // Set initial server host from existing service configuration
    const backendUrl = getHost();
    state.set("server.host", backendUrl);

    // Set up server input handlers
    this.setupEventHandlers();

    // Initial server status check
    this.checkStatus();
  }

  setupEventHandlers() {
    // LED click to refresh status
    document.addEventListener("click", (e) => {
      if (e.target.closest("#server-status-led")) {
        e.preventDefault();
        this.checkStatus();
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

    // Subscribe to server state changes for LED updates
    state.subscribe("server", (server) => {
      try {
        this.updateServerLED(server.online, server.host);
        this.updateCloudIndicator(server.info);
      } catch (error) {
        console.error("Error updating server UI:", error);
      }
    });
  }

  async checkStatus() {
    if (this.isCheckingServer) return;

    this.isCheckingServer = true;
    const host = getHost();

    if (!host) {
      this.isCheckingServer = false;
      return;
    }

    try {
      const headers = getHeaders();

      // Test basic connection
      const testResponse = await fetch(`${host}/test-connection`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(5000),
      });

      const isOnline = testResponse.ok;
      let serverInfo = {};
      let connectionValidation = { basic: isOnline, protected: false, error: null };

      if (isOnline) {
        const data = await testResponse.json();
        serverInfo = {
          connectionType: data.connection_type || "Unknown API",
          connectionUrl: data.connection_url || host,
          environment: data.environment || "unknown",
        };

        // Test protected endpoint if API key available
        if (getApiKey()) {
          try {
            const protectedResponse = await fetch(`${host}/analyze-patterns`, {
              method: "POST",
              headers: headers,
              body: JSON.stringify({ patterns: ["test"] }),
              signal: AbortSignal.timeout(3000),
            });

            connectionValidation.protected = protectedResponse.ok;

            if (!protectedResponse.ok) {
              if (protectedResponse.status === 401) {
                connectionValidation.error = "API key invalid";
              } else if (protectedResponse.status === 503) {
                connectionValidation.error = "API service unavailable - check API key";
              }
            }
          } catch (protectedError) {
            connectionValidation.error = "Protected endpoints unreachable";
          }
        }
      }

      // Update state
      state.update({
        "server.online": isOnline,
        "server.host": host,
        "server.info": serverInfo,
        "server.validation": connectionValidation,
      });

      // Show appropriate status messages
      if (!isOnline) {
        state.setStatus("Server connection failed", true);
      } else if (getApiKey() && !connectionValidation.protected) {
        // Server is online but API key issues - show warning but don't treat as error
        state.setStatus(`Server online - ${connectionValidation.error || "API key validation failed"}`, true);
      } else if (isOnline && getApiKey() && connectionValidation.protected) {
        // Everything working perfectly
        state.setStatus("Server online - API key validated");
      } else if (isOnline && !getApiKey()) {
        // Server online but no API key set
        state.setStatus("Server online - API key not set");
      } else if (isOnline) {
        // Basic connection working
        state.setStatus("Server online");
      }
    } catch (error) {
      state.update({
        "server.online": false,
        "server.host": host,
        "server.info": {},
        "server.validation": { basic: false, protected: false, error: error.message },
      });
      state.setStatus(`Connection error: ${error.message}`, true);
    } finally {
      this.isCheckingServer = false;
    }
  }

  updateServerLED(isOnline, host) {
    const led = document.getElementById("server-status-led");
    if (!led) return;

    led.className = `status-led ${isOnline ? "online" : "offline"}`;

    const status = isOnline ? "Online" : "Offline";
    const serverInfo = state.get("server.info") || {};

    const tooltipText =
      isOnline && serverInfo.connectionType && serverInfo.connectionUrl
        ? `${serverInfo.connectionType}\n${serverInfo.connectionUrl}\nStatus: ${status}\nClick to refresh`
        : `Server: ${host || "Unknown"}\nStatus: ${status}\nClick to refresh`;

    led.title = tooltipText;
  }

  updateCloudIndicator(serverInfo) {
    const cloudIndicator = document.getElementById("cloud-indicator");
    if (!cloudIndicator) return;

    const isCloudAPI = serverInfo?.connectionType === "Cloud API";
    cloudIndicator.classList.toggle("hidden", !isCloudAPI);
  }
}

export { ServerStatusManager };
