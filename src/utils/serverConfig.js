// utils/serverConfig.js
import { state } from "../shared-services/state.manager.js";

export const ServerConfig = {
  getHost: () => state.get("server.host") || "http://127.0.0.1:8000",
  
  getApiKey: () => state.get("server.apiKey"),
  
  getHeaders: () => {
    const headers = { "Content-Type": "application/json" };
    const apiKey = ServerConfig.getApiKey();
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }
    return headers;
  }
};