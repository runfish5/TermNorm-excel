// utils/serverConfig.js
import { state } from "../shared-services/state.manager.js";

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
