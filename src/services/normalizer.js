// services/normalizer.js - Three-tier term normalization: Exact → Fuzzy → LLM
import { getCachedMatch, findFuzzyMatch as findFuzzyMatchDomain } from "../matchers/matchers.js";
import { FUZZY_THRESHOLDS, SESSION_ENDPOINTS } from "../config/config.js";
import { getHeaders, buildUrl } from "../utils/api-fetch.js";
import { getStateValue, setWebSearchStatus } from "../core/state-actions.js";
import { ensureSessionInitialized, executeWithSessionRecovery } from "./workflows.js";
import { showMessage } from "../utils/error-display.js";
import { apiPost, logMatch } from "../utils/api-fetch.js";

export { getCachedMatch };

export function findFuzzyMatch(value, forward, reverse) {
  return findFuzzyMatchDomain(value, forward, reverse, FUZZY_THRESHOLDS.FORWARD, FUZZY_THRESHOLDS.REVERSE);
}

export async function findTokenMatch(value) {
  const normalized = value ? String(value).trim() : "";
  if (!normalized || !(await ensureSessionInitialized())) return null;

  setWebSearchStatus('idle');
  const skipLlmRanking = getStateValue('settings.useLlmRanking') === false;
  const data = await executeWithSessionRecovery(() => apiPost(buildUrl(SESSION_ENDPOINTS.RESEARCH), { query: normalized, skip_llm_ranking: skipLlmRanking }, getHeaders()));
  if (!data) return null;
  if (data.web_search_status) setWebSearchStatus(data.web_search_status, data.web_search_error || null);

  const best = data.ranked_candidates?.[0];
  if (!best) { showMessage("No matches found"); return null; }
  return { target: best.candidate, method: "ProfileRank", confidence: best.relevance_score, timestamp: new Date().toISOString(), source: data.query || best.candidate, candidates: data.ranked_candidates, total_time: data.total_time, llm_provider: data.llm_provider, web_search_status: data.web_search_status };
}

const normalize = (r) => ({ target: r.target || "Unknown", method: r.method || "unknown", confidence: r.confidence ?? 0, timestamp: r.timestamp || new Date().toISOString(), source: r.source || "", candidates: r.candidates || null, entity_profile: r.entity_profile || null, web_sources: r.web_sources || null, total_time: r.total_time || null, llm_provider: r.llm_provider || null, web_search_status: r.web_search_status || "idle" });

/**
 * Three-tier term normalization: Cache → Fuzzy → LLM research
 * @param {string} value - Input term to normalize
 * @param {Object<string, string|{target: string}>} forward - Source→target mappings
 * @param {Object<string, string>} reverse - Target→source mappings
 * @returns {Promise<import('../config/config.js').MatchResult>}
 */
export async function processTermNormalization(value, forward, reverse) {
  const startTime = performance.now();
  const normalized = value ? String(value).trim() : "";
  if (!normalized) return normalize({ target: "Empty value", method: "no_match", confidence: 0, source: value });
  if (!getStateValue('mappings.loaded')) { showMessage("Mappings not loaded", "error"); return normalize({ target: "Mappings not loaded", method: "no_match", confidence: 0, source: normalized }); }

  const cached = getCachedMatch(normalized, forward, reverse);
  if (cached) {
    logMatch({ source: normalized, target: cached.target, method: 'cached', confidence: 1.0, latency_ms: performance.now() - startTime }, getHeaders());
    return normalize(cached);
  }

  const fuzzy = findFuzzyMatch(normalized, forward, reverse);
  if (fuzzy) {
    logMatch({ source: normalized, target: fuzzy.target, method: 'fuzzy', confidence: fuzzy.confidence, latency_ms: performance.now() - startTime, matched_key: fuzzy.matched_key, direction: fuzzy.direction }, getHeaders());
    return normalize(fuzzy);
  }

  const token = await findTokenMatch(normalized);
  if (token) return normalize(token);

  return normalize({ target: "No matches found", method: "no_match", confidence: 0, source: normalized });
}
