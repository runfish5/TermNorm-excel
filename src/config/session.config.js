/** Session Configuration */

export const SESSION_RETRY = { MAX_ATTEMPTS: 3, DELAYS_MS: [1000, 2000, 4000] };
export const SESSION_ENDPOINTS = { INIT: "/session/init-terms", RESEARCH: "/research-and-match" };

export const ERROR_GUIDANCE = {
  403: "💡 Check your IP is in backend-api/config/users.json",
  500: "💡 Server error - check backend-api/logs/app.log",
  SESSION_LOST: "💡 Session lost - reload mappings or wait for auto-recovery",
  OFFLINE: "💡 Run: start-server-py-LLMs.bat",
};
