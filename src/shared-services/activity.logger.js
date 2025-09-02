// ./utils/activity.logger.js
import { state } from "./state.manager.js";

const sessionId = `excel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export function logActivity(source, target, method, confidence, total_time, llm_provider) {
  const serverHost = state.get("server.host") || "http://127.0.0.1:8000";
  fetch(`${serverHost}/log-activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
