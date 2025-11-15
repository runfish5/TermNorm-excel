// services/normalizer.functions.js - Pure functions for term normalization
import { findBestMatch } from "./normalizer.fuzzy.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { state, notifyStateChange } from "../shared-services/state-machine.manager.js";
import { showMessage } from "../utils/error-display.js";
import { apiPost } from "../utils/api-fetch.js";

// Fuzzy matching thresholds (0.0 - 1.0 similarity score)
const FUZZY_FORWARD_THRESHOLD = 0.7;  // Higher threshold for forward mappings (more strict)
const FUZZY_REVERSE_THRESHOLD = 0.5;  // Lower threshold for reverse mappings (more lenient)

// Normalize value to trimmed string (handles Excel cell types: string, number, null, etc.)
function normalizeValue(value) {
  return value ? String(value).trim() : "";
}

export function getCachedMatch(value, forward, reverse) {
  const normalized = normalizeValue(value);
  if (!normalized) return null;

  if (normalized in forward) {
    const mapping = forward[normalized];
    return {
      target: typeof mapping === "string" ? mapping : mapping.target,
      method: "cached",
      confidence: 1.0,
    };
  }
  return normalized in reverse ? { target: normalized, method: "cached", confidence: 1.0 } : null;
}

export function findFuzzyMatch(value, forward, reverse) {
  const normalized = normalizeValue(value);
  if (!normalized) return null;

  const fwd = findBestMatch(normalized, forward, FUZZY_FORWARD_THRESHOLD);
  if (fwd) {
    return {
      target: typeof fwd.value === "string" ? fwd.value : fwd.value.target,
      method: "fuzzy",
      confidence: fwd.score,
    };
  }

  const rev = findBestMatch(normalized, reverse, FUZZY_REVERSE_THRESHOLD);
  return rev ? { target: rev.key, method: "fuzzy", confidence: rev.score } : null;
}

export async function findTokenMatch(value) {
  const normalized = normalizeValue(value);
  if (!normalized) return null;

  // Clear previous web search warnings (new request starting)
  state.webSearch.status = "idle";
  state.webSearch.error = null;
  notifyStateChange();  // Trigger warning update (clears previous failures)

  // Backend session already initialized with terms when mappings loaded
  const data = await apiPost(
    `${getHost()}/research-and-match`,
    { query: normalized },
    getHeaders()
  );

  if (!data) return null;

  // Update web search state from API response
  if (data.web_search_status) {
    state.webSearch.status = data.web_search_status;
    state.webSearch.error = data.web_search_error || null;
    notifyStateChange();  // Trigger warning update on success/failure
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
    candidates: data.ranked_candidates,
    total_time: data.total_time,
    llm_provider: data.llm_provider,
    web_search_status: data.web_search_status
  };
}

export async function processTermNormalization(value, forward, reverse) {
  const normalized = normalizeValue(value);
  if (!normalized) return null;

  // Verify mappings loaded (server status checked in findTokenMatch if needed)
  if (!state.mappings.loaded) {
    showMessage("Mapping tables not loaded - load configuration first", "error");
    return null;
  }

  // Try cached first
  const cached = getCachedMatch(normalized, forward, reverse);
  if (cached) return cached;

  // Try fuzzy matching before expensive API call
  const fuzzy = findFuzzyMatch(normalized, forward, reverse);
  if (fuzzy) return fuzzy;

  // Fallback to research API for advanced matching
  return await findTokenMatch(normalized);
}
