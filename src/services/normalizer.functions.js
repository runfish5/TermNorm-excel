// services/normalizer.functions.js - Pure functions for term normalization
import { getCachedMatch } from "../domain/normalization/cache-matcher.js";
import { findFuzzyMatch as findFuzzyMatchDomain } from "../domain/normalization/fuzzy-matcher.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { state, notifyStateChange } from "../shared-services/state-machine.manager.js";
import { ensureSessionInitialized, executeWithSessionRecovery } from "../shared-services/session-recovery.js";
import { showMessage } from "../utils/error-display.js";
import { apiPost } from "../utils/api-fetch.js";
import { SESSION_ENDPOINTS } from "../config/session.config.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

// Fuzzy matching thresholds (0.0 - 1.0 similarity score)
const FUZZY_FORWARD_THRESHOLD = 0.7; // Higher threshold for forward mappings (more strict)
const FUZZY_REVERSE_THRESHOLD = 0.5; // Lower threshold for reverse mappings (more lenient)

// Normalize value to trimmed string (handles Excel cell types: string, number, null, etc.)
function normalizeValue(value) {
  return value ? String(value).trim() : "";
}

// Re-export getCachedMatch from domain layer for backward compatibility
// (already imported at top of file)
export { getCachedMatch };

/**
 * Find fuzzy match using string similarity algorithms
 * (Re-exported from domain layer for backward compatibility)
 *
 * @param {string} value - Value to match
 * @param {Object} forward - Forward mapping (source → target)
 * @param {Object} reverse - Reverse mapping (target → target)
 * @returns {Object|null} Match result or null if no fuzzy match above threshold
 */
export function findFuzzyMatch(value, forward, reverse) {
  return findFuzzyMatchDomain(value, forward, reverse, FUZZY_FORWARD_THRESHOLD, FUZZY_REVERSE_THRESHOLD);
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

  state.webSearch = { status: "idle", error: null };
  notifyStateChange();

  if (!(await ensureSessionInitialized())) return null;

  const data = await executeWithSessionRecovery(async () =>
    apiPost(`${getHost()}${SESSION_ENDPOINTS.RESEARCH}`, { query: normalized }, getHeaders())
  );

  if (!data) return null;

  return processResearchResponse(data);
}

function processResearchResponse(data) {
  if (data.web_search_status) {
    state.webSearch = { status: data.web_search_status, error: data.web_search_error || null };
    notifyStateChange();
  }

  const best = data.ranked_candidates?.[0];
  if (!best) {
    showMessage("No matches found");
    return null;
  }

  return {
    target: best.candidate,
    method: "ProfileRank",
    confidence: best.relevance_score,
    timestamp: new Date().toISOString(),
    source: data.query || best.candidate,
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
    target: result.target || "Unknown",
    method: result.method || "unknown",
    confidence: result.confidence ?? 0,
    timestamp: result.timestamp || new Date().toISOString(),
    source: result.source || "",
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

  if (!state.mappings.loaded) {
    showMessage("Mappings not loaded", "error");
    return normalizeResultShape(createDefaultResult(normalized, "Mappings not loaded"));
  }

  // CHECKPOINT 9: Emit normalization method events for observability
  const cached = getCachedMatch(normalized, forward, reverse);
  if (cached) {
    eventBus.emit(Events.NORMALIZATION_METHOD_CACHE, {
      source: normalized,
      target: cached.target,
      confidence: cached.confidence,
    });
    return normalizeResultShape(cached);
  }

  const fuzzy = findFuzzyMatch(normalized, forward, reverse);
  if (fuzzy) {
    eventBus.emit(Events.NORMALIZATION_METHOD_FUZZY, {
      source: normalized,
      target: fuzzy.target,
      confidence: fuzzy.confidence,
    });
    return normalizeResultShape(fuzzy);
  }

  const tokenMatch = await findTokenMatch(normalized);
  if (tokenMatch) {
    eventBus.emit(Events.NORMALIZATION_METHOD_LLM, {
      source: normalized,
      target: tokenMatch.target,
      confidence: tokenMatch.confidence,
      candidates: tokenMatch.candidates,
    });
    return normalizeResultShape(tokenMatch);
  }

  // No match found by any method
  eventBus.emit(Events.NORMALIZATION_NO_MATCH, {
    source: normalized,
  });
  return normalizeResultShape(createDefaultResult(normalized, "No matches found"));
}
