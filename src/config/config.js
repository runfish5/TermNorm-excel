/** Configuration - Session, matching, and UI constants */

// ============================================================================
// TYPE DEFINITIONS (for JSDoc autocomplete)
// ============================================================================

/**
 * @typedef {Object} MatchResult
 * @property {string} target - Matched output value
 * @property {string} method - 'cached'|'fuzzy'|'ProfileRank'|'error'
 * @property {number} confidence - Score 0-1
 * @property {string} timestamp - ISO timestamp
 * @property {string} source - Original input
 * @property {Array|null} [candidates] - LLM candidates (ProfileRank only)
 * @property {Object|null} [entity_profile] - Entity profile (ProfileRank only)
 */

/** @param {Partial<MatchResult>} [r] @returns {MatchResult} */
export const createMatchResult = (r = {}) => ({ target: r.target || "Unknown", method: r.method || "unknown", confidence: r.confidence ?? 0, timestamp: r.timestamp || new Date().toISOString(), source: r.source || "", candidates: r.candidates || null, entity_profile: r.entity_profile || null, web_sources: r.web_sources || null, total_time: r.total_time || null, llm_provider: r.llm_provider || null, web_search_status: r.web_search_status || "idle" });

/**
 * @typedef {Object} CellState
 * @property {string} value - Input value
 * @property {string} status - 'processing'|'complete'|'error'
 * @property {number} row - Row index
 * @property {number} col - Column index
 * @property {number} [targetCol] - Target column index
 * @property {MatchResult} [result] - Match result when complete
 * @property {string} [timestamp] - ISO timestamp
 */

/**
 * @typedef {Object} MappingData
 * @property {Object<string, string|{target: string}>} forward - Source→target mappings
 * @property {Object<string, string>} reverse - Target→source mappings (for verification)
 * @property {Object} [metadata] - Optional metadata about the mappings
 */

// ============================================================================
// SERVER DEFAULTS
// ============================================================================

export const SERVER_DEFAULTS = {
  HOST: "http://127.0.0.1",
  PORT: 8000,
  get URL() { return `${this.HOST}:${this.PORT}`; }
};

// ============================================================================
// SESSION CONFIG
// ============================================================================

// Session (merged from session.config.js)
export const SESSION_RETRY = { MAX_ATTEMPTS: 3, DELAYS_MS: [1000, 2000, 4000] };

// RESTful API endpoints
export const ENDPOINTS = {
  HEALTH: "/health",
  SETTINGS: "/settings",
  SESSIONS: "/sessions",
  MATCHES: "/matches",
  BATCHES: "/batches",
  PROMPTS: "/prompts",
  ACTIVITIES: "/activities",
  ACTIVITY_MATCHES: "/activities/matches",
  HISTORY: "/history",
  CACHE: "/cache",
};

// Legacy aliases for backward compatibility during migration
export const SESSION_ENDPOINTS = { INIT: ENDPOINTS.SESSIONS, RESEARCH: ENDPOINTS.MATCHES };
export const ERROR_GUIDANCE = {
  403: "💡 Check your IP is in backend-api/config/users.json",
  500: "💡 Server error - check backend-api/logs/app.log",
  SESSION_LOST: "💡 Session lost - reload mappings or wait for auto-recovery",
  OFFLINE: "💡 Open your TermNorm folder and double-click start-server-py-LLMs.bat",
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
  MAX_ENTRIES: 999,
};

// User action confidence (UserChoice, DirectEdit = explicit user selection)
export const USER_ACTION_CONFIDENCE = 1.0;

// ============================================================================
// UI CONSTANTS
// ============================================================================

// Timing constants for UI feedback
export const UI_TIMINGS = {
  FEEDBACK_REMOVE_MS: 3000,   // How long feedback messages stay visible
  COPY_RESET_MS: 1500,        // How long "Copied!" stays before resetting
  LOADING_DOTS_MS: 400,       // Animation speed for loading dots
};

// Limits for user inputs
export const LIMITS = {
  MAX_DIRECT_PROMPT_ITEMS: 100,  // Max items in direct prompt batch
  MAX_HEADER_COLUMNS: 100,       // Max columns to scan for headers
};

// Additional UI colors not in RELEVANCE_COLORS
export const UI_COLORS = {
  ERROR_RED: "#F44336",    // Error text/icons
  TEXT_GRAY: "#666",       // Secondary text
};
