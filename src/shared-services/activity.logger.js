// ./utils/activity.logger.js
import { ServerConfig } from "../utils/serverConfig.js";

const sessionId = `excel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export function logActivity(source, target, method, confidence, total_time, llm_provider) {
  fetch(`${ServerConfig.getHost()}/log-activity`, {
    method: "POST",
    headers: ServerConfig.getHeaders(),
    body: JSON.stringify({
      timestamp: new Date().toISOString(),
      source,
      target,
      method,
      confidence,
      total_time,
      llm_provider,
      session_id: sessionId,
    }),
  }).catch((err) => console.warn("Log failed:", err));
}
