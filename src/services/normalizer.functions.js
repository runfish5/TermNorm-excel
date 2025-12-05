// services/normalizer.functions.js - Pure functions for term normalization
import { getCachedMatch } from "../domain/normalization/cache-matcher.js";
import { findFuzzyMatch as findFuzzyMatchDomain } from "../domain/normalization/fuzzy-matcher.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { getStateValue, setWebSearchStatus } from "../core/state-actions.js";
import { ensureSessionInitialized, executeWithSessionRecovery } from "../shared-services/session-recovery.js";
import { showMessage } from "../utils/error-display.js";
import { apiPost } from "../utils/api-fetch.js";
import { SESSION_ENDPOINTS } from "../config/session.config.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

const FUZZY_FORWARD_THRESHOLD = 0.7;
const FUZZY_REVERSE_THRESHOLD = 0.5;

function normalizeValue(value) {
  return value ? String(value).trim() : "";
}

export { getCachedMatch };

/** Find fuzzy match using string similarity algorithms */
export function findFuzzyMatch(value, forward, reverse) {
  return findFuzzyMatchDomain(value, forward, reverse, FUZZY_FORWARD_THRESHOLD, FUZZY_REVERSE_THRESHOLD);
}

/** Find token match using backend research and ranking API */
export async function findTokenMatch(value) {
  const normalized = normalizeValue(value);
  if (!normalized) return null;

  setWebSearchStatus('idle');
  if (!(await ensureSessionInitialized())) return null;

  const data = await executeWithSessionRecovery(async () =>
    apiPost(`${getHost()}${SESSION_ENDPOINTS.RESEARCH}`, { query: normalized }, getHeaders())
  );
  if (!data) return null;

  if (data.web_search_status) setWebSearchStatus(data.web_search_status, data.web_search_error || null);

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

/** Normalize result object to guaranteed schema */
function normalizeResult(result) {
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

/** Create no-match result */
function noMatch(value, reason = "No matches found") {
  return normalizeResult({ target: reason, method: "no_match", confidence: 0, source: value });
}

/** Process term normalization with three-tier fallback: Exact → Fuzzy → LLM */
export async function processTermNormalization(value, forward, reverse) {
  const normalized = normalizeValue(value);
  if (!normalized) return noMatch(value, "Empty value");

  if (!getStateValue('mappings.loaded')) {
    showMessage("Mappings not loaded", "error");
    return noMatch(normalized, "Mappings not loaded");
  }

  // Tier 1: Exact cache match
  const cached = getCachedMatch(normalized, forward, reverse);
  if (cached) {
    eventBus.emit(Events.NORMALIZATION_METHOD_CACHE, { source: normalized, target: cached.target, confidence: cached.confidence });
    return normalizeResult(cached);
  }

  // Tier 2: Fuzzy match
  const fuzzy = findFuzzyMatch(normalized, forward, reverse);
  if (fuzzy) {
    eventBus.emit(Events.NORMALIZATION_METHOD_FUZZY, { source: normalized, target: fuzzy.target, confidence: fuzzy.confidence });
    return normalizeResult(fuzzy);
  }

  // Tier 3: LLM research
  const tokenMatch = await findTokenMatch(normalized);
  if (tokenMatch) {
    eventBus.emit(Events.NORMALIZATION_METHOD_LLM, { source: normalized, target: tokenMatch.target, confidence: tokenMatch.confidence, candidates: tokenMatch.candidates });
    return normalizeResult(tokenMatch);
  }

  eventBus.emit(Events.NORMALIZATION_NO_MATCH, { source: normalized });
  return noMatch(normalized);
}
