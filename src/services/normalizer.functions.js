// services/normalizer.functions.js - Pure functions for term normalization
import { findBestMatch } from "./normalizer.fuzzy.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { state, notifyStateChange } from "../shared-services/state-machine.manager.js";
import { ensureSessionInitialized, executeWithSessionRecovery } from "../shared-services/session-recovery.js";
import { showMessage } from "../utils/error-display.js";
import { apiPost } from "../utils/api-fetch.js";
import { SESSION_ENDPOINTS } from "../config/session.config.js";

// Fuzzy matching thresholds (0.0 - 1.0 similarity score)
const FUZZY_FORWARD_THRESHOLD = 0.7; // Higher threshold for forward mappings (more strict)
const FUZZY_REVERSE_THRESHOLD = 0.5; // Lower threshold for reverse mappings (more lenient)

// Normalize value to trimmed string (handles Excel cell types: string, number, null, etc.)
function normalizeValue(value) {
  return value ? String(value).trim() : "";
}

/**
 * Get exact cached match from forward or reverse mappings
 *
 * @param {string} value - Value to match
 * @param {Object} forward - Forward mapping (source → target)
 * @param {Object} reverse - Reverse mapping (target → target)
 * @returns {Object|null} Match result or null if no exact match found
 */
export function getCachedMatch(value, forward, reverse) {
  const normalized = normalizeValue(value);
  if (!normalized) return null;

  if (normalized in forward) {
    const mapping = forward[normalized];
    return {
      target: typeof mapping === "string" ? mapping : mapping.target,
      method: "cached",
      confidence: 1.0,
      timestamp: new Date().toISOString(),
      source: normalized,
    };
  }
  return normalized in reverse
    ? { target: normalized, method: "cached", confidence: 1.0, timestamp: new Date().toISOString(), source: normalized }
    : null;
}

/**
 * Find fuzzy match using string similarity algorithms
 *
 * @param {string} value - Value to match
 * @param {Object} forward - Forward mapping (source → target)
 * @param {Object} reverse - Reverse mapping (target → target)
 * @returns {Object|null} Match result or null if no fuzzy match above threshold
 */
export function findFuzzyMatch(value, forward, reverse) {
  const normalized = normalizeValue(value);
  if (!normalized) return null;

  const fwd = findBestMatch(normalized, forward, FUZZY_FORWARD_THRESHOLD);
  if (fwd) {
    return {
      target: typeof fwd.value === "string" ? fwd.value : fwd.value.target,
      method: "fuzzy",
      confidence: fwd.score,
      timestamp: new Date().toISOString(),
      source: normalized,
    };
  }

  const rev = findBestMatch(normalized, reverse, FUZZY_REVERSE_THRESHOLD);
  return rev
    ? {
        target: rev.key,
        method: "fuzzy",
        confidence: rev.score,
        timestamp: new Date().toISOString(),
        source: normalized,
      }
    : null;
}

/**
 * Find token match using backend research and ranking API
 *
 * @param {string} value - Value to match
 * @returns {Promise<Object|null>} Match result with candidate, method, confidence, etc., or null if no match
 */
export async function findTokenMatch(value) {
  const normalized = normalizeValue(value);
  if (!normalized) return null;

  // Clear previous web search warnings (new request starting)
  state.webSearch.status = "idle";
  state.webSearch.error = null;
  notifyStateChange();

  // Proactive check: Ensure session is initialized
  const sessionReady = await ensureSessionInitialized();
  if (!sessionReady) {
    return null;
  }

  // Make request with automatic session recovery
  const data = await executeWithSessionRecovery(async () => makeResearchRequest(normalized));

  if (!data) return null;

  return processResearchResponse(data);
}

/**
 * Make research request to backend API
 *
 * @param {string} query - Normalized query string
 * @returns {Promise<Object|null>} API response data or null
 */
async function makeResearchRequest(query) {
  return await apiPost(`${getHost()}${SESSION_ENDPOINTS.RESEARCH}`, { query }, getHeaders());
}

/**
 * Process research API response and update state
 *
 * @param {Object} data - API response data
 * @returns {Object|null} Processed match result or null
 */
function processResearchResponse(data) {
  // Update web search state from API response
  if (data.web_search_status) {
    state.webSearch.status = data.web_search_status;
    state.webSearch.error = data.web_search_error || null;
    notifyStateChange();
  }

  // Check if we have candidates
  if (!data.ranked_candidates?.length) {
    showMessage("No matches found");
    return null;
  }

  const best = data.ranked_candidates[0];
  if (!best) {
    showMessage("No valid candidates");
    return null;
  }

  return {
    target: best.candidate,
    method: "ProfileRank",
    confidence: best.relevance_score,
    timestamp: new Date().toISOString(),
    source: data.query || best.candidate, // Use query if available, fallback to candidate
    candidates: data.ranked_candidates,
    total_time: data.total_time,
    llm_provider: data.llm_provider,
    web_search_status: data.web_search_status,
  };
}

/**
 * Normalize result object to guaranteed schema
 * Ensures consistent structure regardless of match method (cached/fuzzy/LLM)
 *
 * @param {Object} result - Raw result object from any match method
 * @returns {Object} Normalized result with all fields explicitly defined
 */
function normalizeResultShape(result) {
  return {
    // Core fields (all methods)
    target: result.target || "Unknown",
    method: result.method || "unknown",
    confidence: result.confidence ?? 0,
    timestamp: result.timestamp || new Date().toISOString(),
    source: result.source || "",

    // LLM fields (default to null if missing)
    candidates: result.candidates || null,
    entity_profile: result.entity_profile || null,
    web_sources: result.web_sources || null,
    total_time: result.total_time || null,
    llm_provider: result.llm_provider || null,
    web_search_status: result.web_search_status || "idle",
  };
}

/**
 * Create default result when no match found
 *
 * @param {string} value - Source value
 * @param {string} reason - Reason for no match
 * @returns {Object} Default result object
 */
function createDefaultResult(value, reason = "No matches found") {
  return {
    target: reason,
    method: "no_match",
    confidence: 0,
    timestamp: new Date().toISOString(),
    source: value,
  };
}

/**
 * Process term normalization with three-tier fallback: Exact → Fuzzy → LLM
 * ALWAYS returns a valid result object (never null)
 *
 * @param {string} value - Value to normalize
 * @param {Object} forward - Forward mapping (source → target)
 * @param {Object} reverse - Reverse mapping (target → target)
 * @returns {Promise<Object>} Normalized result (always valid object)
 */
export async function processTermNormalization(value, forward, reverse) {
  const normalized = normalizeValue(value);
  if (!normalized) return normalizeResultShape(createDefaultResult(value, "Empty value"));

  // Verify mappings loaded (server status checked in findTokenMatch if needed)
  if (!state.mappings.loaded) {
    showMessage("Mapping tables not loaded - load configuration first", "error");
    return normalizeResultShape(createDefaultResult(normalized, "Mappings not loaded"));
  }

  // Try cached first
  const cached = getCachedMatch(normalized, forward, reverse);
  if (cached) return normalizeResultShape(cached);

  // Try fuzzy matching before expensive API call
  const fuzzy = findFuzzyMatch(normalized, forward, reverse);
  if (fuzzy) return normalizeResultShape(fuzzy);

  // Fallback to research API for advanced matching
  const tokenMatch = await findTokenMatch(normalized);
  const result = tokenMatch || createDefaultResult(normalized, "No matches found");
  return normalizeResultShape(result);
}
