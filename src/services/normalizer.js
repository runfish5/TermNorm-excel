// services/normalizer.js - Three-tier term normalization: Exact → Fuzzy → LLM
import { getCachedMatch, findFuzzyMatch as findFuzzyMatchDomain } from "../matchers/matchers.js";
import { SESSION_ENDPOINTS, createMatchResult } from "../config/config.js";
import { getHeaders, buildUrl, apiPost, logMatch, createPipelineTrace, reportPipelineStep } from "../utils/api-fetch.js";
import { getStateValue, setWebSearchStatus } from "../core/state-actions.js";
import { ensureSessionInitialized, executeWithSessionRecovery } from "./workflows.js";
import { showMessage } from "../utils/ui-feedback.js";
import frontendPipeline from "../config/pipeline.json";

// Pipeline config from local pipeline.json (webpack 5 imports JSON natively)
const _fuzzyThreshold = frontendPipeline.nodes.fuzzy_matching.config.threshold;
const _backendToggles = frontendPipeline.backend_toggles || {};

/** Build backend steps array from toggle states and pipeline config */
function buildBackendSteps() {
  const disabled = new Set();
  for (const [setting, steps] of Object.entries(_backendToggles)) {
    if (getStateValue(`settings.${setting}`) === false) {
      steps.forEach(s => disabled.add(s));
    }
  }
  // Backend default pipeline: web_search, entity_profiling, token_matching, llm_ranking
  return ["web_search", "entity_profiling", "token_matching", "llm_ranking"]
    .filter(s => !disabled.has(s));
}

export function findFuzzyMatch(value, forward, reverse) {
  return findFuzzyMatchDomain(value, forward, reverse, _fuzzyThreshold);
}

export async function findTokenMatch(value, traceId = null) {
  const normalized = value ? String(value).trim() : "";
  if (!normalized || !(await ensureSessionInitialized())) return null;

  setWebSearchStatus('idle');
  const payload = { query: normalized, steps: buildBackendSteps() };
  if (traceId) payload.trace_id = traceId;
  const data = await executeWithSessionRecovery(() => apiPost(buildUrl(SESSION_ENDPOINTS.RESEARCH), payload, getHeaders()));
  if (!data) return null;
  if (data.web_search_status) setWebSearchStatus(data.web_search_status, data.web_search_error || null);

  const best = data.ranked_candidates?.[0];
  if (!best) { showMessage("No matches found"); return null; }
  return createMatchResult({ target: best.candidate, method: "ProfileRank", confidence: best.relevance_score, source: data.query || best.candidate, candidates: data.ranked_candidates, total_time: data.total_time, llm_provider: data.llm_provider, web_search_status: data.web_search_status });
}

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
  if (!normalized) return createMatchResult({ target: "Empty value", method: "no_match", confidence: 0, source: value });
  if (!getStateValue('mappings.loaded')) { showMessage("Mappings not loaded", "error"); return createMatchResult({ target: "Mappings not loaded", method: "no_match", confidence: 0, source: normalized }); }

  // Create unified trace for this query (include pipeline version for trace metadata)
  const traceData = await createPipelineTrace(normalized, getHeaders(), frontendPipeline.version);
  const traceId = traceData?.trace_id;

  // Tier 1: Cache lookup
  const cached = getCachedMatch(normalized, forward, reverse);
  if (cached) {
    const latency = performance.now() - startTime;
    if (traceId) reportPipelineStep(traceId, 'cache_lookup', { ...cached, source: normalized }, latency, getHeaders());
    else logMatch({ source: normalized, target: cached.target, method: 'cached', confidence: 1.0, latency_ms: latency }, getHeaders());
    return createMatchResult(cached);
  }
  // Report cache miss
  if (traceId) reportPipelineStep(traceId, 'cache_lookup', { source: normalized, method: 'miss' }, performance.now() - startTime, getHeaders());

  // Tier 2: Fuzzy matching
  const fuzzy = findFuzzyMatch(normalized, forward, reverse);
  if (fuzzy) {
    const latency = performance.now() - startTime;
    if (traceId) reportPipelineStep(traceId, 'fuzzy_matching', { ...fuzzy, source: normalized }, latency, getHeaders());
    else logMatch({ source: normalized, target: fuzzy.target, method: 'fuzzy', confidence: fuzzy.confidence, latency_ms: latency, matched_key: fuzzy.matched_key }, getHeaders());
    return createMatchResult(fuzzy);
  }
  // Report fuzzy miss
  if (traceId) reportPipelineStep(traceId, 'fuzzy_matching', { source: normalized, method: 'miss' }, performance.now() - startTime, getHeaders());

  // Tier 3: LLM research — pass trace_id so backend adds to same trace
  const token = await findTokenMatch(normalized, traceId);
  if (token) return token;

  return createMatchResult({ target: "No matches found", method: "no_match", confidence: 0, source: normalized });
}
