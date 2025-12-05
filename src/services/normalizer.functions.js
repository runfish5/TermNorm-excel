// services/normalizer.functions.js - Three-tier term normalization: Exact → Fuzzy → LLM
import { getCachedMatch } from "../domain/normalization/cache-matcher.js";
import { findFuzzyMatch as findFuzzyMatchDomain } from "../domain/normalization/fuzzy-matcher.js";
import { FUZZY_THRESHOLDS } from "../config/normalization.config.js";
import { getHost, getHeaders } from "../utils/server-utilities.js";
import { getStateValue, setWebSearchStatus } from "../core/state-actions.js";
import { ensureSessionInitialized, executeWithSessionRecovery } from "../shared-services/session-recovery.js";
import { showMessage } from "../utils/error-display.js";
import { apiPost } from "../utils/api-fetch.js";
import { SESSION_ENDPOINTS } from "../config/session.config.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";

export { getCachedMatch };

export function findFuzzyMatch(value, forward, reverse) {
  return findFuzzyMatchDomain(value, forward, reverse, FUZZY_THRESHOLDS.FORWARD, FUZZY_THRESHOLDS.REVERSE);
}

export async function findTokenMatch(value) {
  const normalized = value ? String(value).trim() : "";
  if (!normalized || !(await ensureSessionInitialized())) return null;

  setWebSearchStatus('idle');
  const data = await executeWithSessionRecovery(() => apiPost(`${getHost()}${SESSION_ENDPOINTS.RESEARCH}`, { query: normalized }, getHeaders()));
  if (!data) return null;

  if (data.web_search_status) setWebSearchStatus(data.web_search_status, data.web_search_error || null);

  const best = data.ranked_candidates?.[0];
  if (!best) { showMessage("No matches found"); return null; }

  return { target: best.candidate, method: "ProfileRank", confidence: best.relevance_score, timestamp: new Date().toISOString(), source: data.query || best.candidate, candidates: data.ranked_candidates, total_time: data.total_time, llm_provider: data.llm_provider, web_search_status: data.web_search_status };
}

function normalize(result) {
  return { target: result.target || "Unknown", method: result.method || "unknown", confidence: result.confidence ?? 0, timestamp: result.timestamp || new Date().toISOString(), source: result.source || "", candidates: result.candidates || null, entity_profile: result.entity_profile || null, web_sources: result.web_sources || null, total_time: result.total_time || null, llm_provider: result.llm_provider || null, web_search_status: result.web_search_status || "idle" };
}

export async function processTermNormalization(value, forward, reverse) {
  const normalized = value ? String(value).trim() : "";
  if (!normalized) return normalize({ target: "Empty value", method: "no_match", confidence: 0, source: value });

  if (!getStateValue('mappings.loaded')) {
    showMessage("Mappings not loaded", "error");
    return normalize({ target: "Mappings not loaded", method: "no_match", confidence: 0, source: normalized });
  }

  const cached = getCachedMatch(normalized, forward, reverse);
  if (cached) { eventBus.emit(Events.NORMALIZATION_METHOD_CACHE, { source: normalized, target: cached.target, confidence: cached.confidence }); return normalize(cached); }

  const fuzzy = findFuzzyMatch(normalized, forward, reverse);
  if (fuzzy) { eventBus.emit(Events.NORMALIZATION_METHOD_FUZZY, { source: normalized, target: fuzzy.target, confidence: fuzzy.confidence }); return normalize(fuzzy); }

  const token = await findTokenMatch(normalized);
  if (token) { eventBus.emit(Events.NORMALIZATION_METHOD_LLM, { source: normalized, target: token.target, confidence: token.confidence, candidates: token.candidates }); return normalize(token); }

  eventBus.emit(Events.NORMALIZATION_NO_MATCH, { source: normalized });
  return normalize({ target: "No matches found", method: "no_match", confidence: 0, source: normalized });
}
