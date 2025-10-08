// services/normalizer.functions.js - Pure functions for term normalization
import { findBestMatch } from "./normalizer.fuzzy.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { getState } from "../shared-services/state-machine.manager.js";
import { showMessage } from "../utils/error-display.js";
import { apiPost } from "../utils/api-fetch.js";

export function getCachedMatch(value, forward, reverse) {
  const val = String(value || "").trim();
  if (!val) return null;

  if (val in forward) {
    const mapping = forward[val];
    return {
      target: typeof mapping === "string" ? mapping : mapping.target,
      method: "cached",
      confidence: 1.0,
    };
  }
  return val in reverse ? { target: val, method: "cached", confidence: 1.0 } : null;
}

export function findFuzzyMatch(value, forward, reverse) {
  const val = String(value || "").trim();
  if (!val) return null;

  const fwd = findBestMatch(val, forward, 0.7);
  if (fwd) {
    return {
      target: typeof fwd.value === "string" ? fwd.value : fwd.value.target,
      method: "fuzzy",
      confidence: fwd.score,
    };
  }

  const rev = findBestMatch(val, reverse, 0.5);
  return rev ? { target: rev.key, method: "fuzzy", confidence: rev.score } : null;
}

export async function findTokenMatch(value) {
  const val = String(value || "").trim();
  if (!val) return null;

  const state = getState();

  // Extract terms from cached mappings
  const terms = state.mappings.combined?.reverse ? Object.keys(state.mappings.combined.reverse) : [];

  if (!terms.length) {
    showMessage("No terms available - load mappings first", "error");
    return null;
  }

  const data = await apiPost(
    `${getHost()}/research-and-match`,
    {
      query: val,
      terms: terms
    },
    getHeaders()
  );

  if (!data) return null;

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
    llm_provider: data.llm_provider
  };
}

export async function processTermNormalization(value, forward, reverse) {
  const val = String(value || "").trim();
  if (!val) return null;

  // Verify mappings loaded (server status checked in findTokenMatch if needed)
  const state = getState();
  if (!state.mappings.loaded) {
    showMessage("Mapping tables not loaded - load configuration first", "error");
    return null;
  }

  // Try cached first
  const cached = getCachedMatch(val, forward, reverse);
  if (cached) return cached;

  // Try fuzzy matching before expensive API call
  const fuzzy = findFuzzyMatch(val, forward, reverse);
  if (fuzzy) return fuzzy;

  // Fallback to research API for advanced matching
  return await findTokenMatch(val);
}
