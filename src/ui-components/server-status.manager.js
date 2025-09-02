// ui-components/server-status.manager.js
import { state } from "../shared-services/state.manager.js";

export class ServerStatusManager {
  constructor(orchestrator = null) {
    this.orchestrator = orchestrator;
    this.elements = new Map();
    this.isChecking = false;
  }

  init() {
    this.setupInitialConfig();
    this.setupEventListeners();
    this.checkServerStatus();
  }

  setupInitialConfig() {
    // Set initial server host from existing service configuration
    const backendUrl = this.orchestrator?.aiPromptRenewer?.backendUrl || "http://127.0.0.1:8000";
    state.set("server.host", backendUrl);
  }

  setupEventListeners() {
    // Set up input handlers for server configuration
    const inputHandlers = [
      { id: "server-status-led", event: "click", handler: () => this.checkServerStatus() },
      { id: "api-key-input", event: "input", handler: (e) => state.set("server.apiKey", e.target.value.trim()) },
      { id: "server-url-input", event: "input", handler: (e) => state.set("server.host", e.target.value.trim()) }
    ];

    inputHandlers.forEach(({ id, event, handler }) => {
      const element = this.getElement(id);
      if (element) {
        element.addEventListener(event, handler);
      }
    });

    // Subscribe to server state changes
    state.subscribe("server", (server) => {
      this.updateServerLED(server.online, server.host);
      this.updateCloudIndicator(server.info);
    });
  }

  getElement(id) {
    if (!this.elements.has(id)) {
      const element = document.getElementById(id);
      if (element) {
        this.elements.set(id, element);
      }
    }
    return this.elements.get(id) || null;
  }

  async checkServerStatus() {
    if (this.isChecking) return; // Prevent multiple simultaneous checks
    
    this.isChecking = true;
    const host = state.get("server.host");
    
    if (!host) {
      this.isChecking = false;
      return;
    }

    try {
      const apiKey = state.get("server.apiKey");
      const headers = { "Content-Type": "application/json" };
      if (apiKey) {
        headers["X-API-Key"] = apiKey;
      }

      // Test basic connection first
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

        // Test a protected endpoint to validate full functionality
        if (apiKey) {
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

      // Update state with results
      state.update({
        "server.online": isOnline,
        "server.host": host,
        "server.info": serverInfo,
        "server.validation": connectionValidation,
      });

      // Show specific error messages
      if (!isOnline) {
        state.setStatus("Server connection failed", true);
      } else if (apiKey && !connectionValidation.protected) {
        state.setStatus(connectionValidation.error || "API endpoints not accessible", true);
      } else if (!testResponse.ok && testResponse.status === 401) {
        state.setStatus("API key required or invalid", true);
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
      this.isChecking = false;
    }
  }

  updateServerLED(isOnline, host) {
    const led = this.getElement("server-status-led");
    if (!led) return;

    led.className = `status-led ${isOnline ? "online" : "offline"}`;
    
    const status = isOnline ? "Online" : "Offline";
    const serverInfo = state.get("server.info") || {};
    
    const tooltipText = isOnline && serverInfo.connectionType && serverInfo.connectionUrl
      ? `${serverInfo.connectionType}\n${serverInfo.connectionUrl}\nStatus: ${status}\nClick to refresh`
      : `Server: ${host || "Unknown"}\nStatus: ${status}\nClick to refresh`;

    led.title = tooltipText;

    // Emit server status event
    this.emit('statusChanged', { online: isOnline, host, serverInfo });
  }

  updateCloudIndicator(serverInfo) {
    const cloudIndicator = this.getElement("cloud-indicator");
    if (!cloudIndicator) return;

    const isCloudAPI = serverInfo?.connectionType === "Cloud API";
    cloudIndicator.classList.toggle("hidden", !isCloudAPI);
  }

  // Public API
  isServerOnline() {
    return state.get("server.online") || false;
  }

  getServerInfo() {
    return state.get("server.info") || {};
  }

  // Event emitter
  emit(eventName, data) {
    const event = new CustomEvent(`server:${eventName}`, {
      detail: data,
      bubbles: true
    });
    document.dispatchEvent(event);
  }

  on(eventName, callback) {
    document.addEventListener(`server:${eventName}`, callback);
  }
}