/** Configuration - Session, matching, and UI constants */

// Session (merged from session.config.js)
export const SESSION_RETRY = { MAX_ATTEMPTS: 3, DELAYS_MS: [1000, 2000, 4000] };
export const SESSION_ENDPOINTS = { INIT: "/session/init-terms", RESEARCH: "/research-and-match" };
export const ERROR_GUIDANCE = {
  403: "💡 Check your IP is in backend-api/config/users.json",
  500: "💡 Server error - check backend-api/logs/app.log",
  SESSION_LOST: "💡 Session lost - reload mappings or wait for auto-recovery",
  OFFLINE: "💡 Run: start-server-py-LLMs.bat",
};

// Fuzzy matching thresholds
export const FUZZY_THRESHOLDS = {
  FORWARD: 0.7,      // Minimum similarity for source→target matching
  REVERSE: 0.5,      // Minimum similarity for target→source verification
  DEFAULT: 0.6,      // Default threshold for general fuzzy operations
};

// Confidence score thresholds for UI coloring
export const RELEVANCE_THRESHOLDS = {
  EXCELLENT: 0.9,    // Green - high confidence
  GOOD: 0.8,         // Yellow - good confidence
  MODERATE: 0.6,     // Orange - moderate confidence
  LOW: 0.2,          // Red - low confidence
};

// Color codes for confidence levels
export const RELEVANCE_COLORS = {
  EXCELLENT: "#C6EFCE",  // Green
  GOOD: "#FFEB9C",       // Yellow
  MODERATE: "#FFD1A9",   // Orange
  LOW: "#FFC7CE",        // Red
  NONE: "#E1E1E1",       // Gray
};

// Processing state colors
export const PROCESSING_COLORS = {
  PENDING: "#FFFB9D",
  ERROR: "#FFC7CE",
  CLEAR: null,
};

// Event log settings
export const EVENT_LOG = {
  MAX_ENTRIES: 50,
};
