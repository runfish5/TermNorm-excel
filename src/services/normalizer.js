// services/normalizer.js - Three-tier term normalization: Exact → Fuzzy → LLM
import { getCachedMatch, findFuzzyMatch as findFuzzyMatchDomain } from "../matchers/matchers.js";
import { ENDPOINTS, createMatchResult } from "../config/config.js";
import { getHeaders, buildUrl, apiPost, logMatch, createPipelineTrace, reportPipelineStep } from "../utils/api-fetch.js";
import { getStateValue, setWebSearchStatus } from "../core/state-actions.js";
import { eventBus } from "../core/event-bus.js";
import { Events } from "../core/events.js";
import { ensureSessionInitialized, executeWithSessionRecovery } from "./workflows.js";
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
  return (frontendPipeline.backend_default_steps || [])
    .filter(s => !disabled.has(s));
}

/** Report a pipeline step to trace or log as a standalone match */
function _report(traceId, step, data, latency, normalized) {
  if (traceId) reportPipelineStep(traceId, step, data, latency, getHeaders());
  else logMatch({ source: normalized, target: data.target, method: step === 'cache_lookup' ? 'cached' : 'fuzzy', confidence: data.confidence ?? 1.0, latency_ms: latency, ...(data.matched_key ? { matched_key: data.matched_key } : {}) }, getHeaders());
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
  const data = await executeWithSessionRecovery(() => apiPost(buildUrl(ENDPOINTS.MATCHES), payload, getHeaders()));
  if (!data) return null;
  if (data.web_search_status) setWebSearchStatus(data.web_search_status, data.web_search_error || null);

  const best = data.ranked_candidates?.[0];
  if (!best) return null;
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
  if (!getStateValue('mappings.loaded')) return createMatchResult({ target: "Mappings not loaded", method: "no_match", confidence: 0, source: normalized });

  eventBus.emit(Events.PIPELINE_STARTED);

  // Create unified trace for this query (include pipeline version for trace metadata)
  const traceData = await createPipelineTrace(normalized, getHeaders(), frontendPipeline.version);
  const traceId = traceData?.trace_id;

  // Tier 1: Cache lookup
  const cached = getCachedMatch(normalized, forward, reverse);
  if (cached) {
    const elapsed = performance.now() - startTime;
    _report(traceId, 'cache_lookup', { ...cached, source: normalized }, elapsed, normalized);
    eventBus.emit(Events.SERVICE_MESSAGE, { text: `Match [exact] in ${Math.round(elapsed)}ms` });
    eventBus.emit(Events.PIPELINE_FINISHED, { method: 'cached' });
    return createMatchResult(cached);
  }
  if (traceId) _report(traceId, 'cache_lookup', { source: normalized, method: 'miss' }, performance.now() - startTime, normalized);

  // Tier 2: Fuzzy matching (JS — toggleable via settings)
  if (getStateValue('settings.useJsFuzzy') !== false) {
    const fuzzy = findFuzzyMatch(normalized, forward, reverse);
    if (fuzzy) {
      const elapsed = performance.now() - startTime;
      _report(traceId, 'fuzzy_matching', { ...fuzzy, source: normalized }, elapsed, normalized);
      forward[normalized] = fuzzy.target;
      if (!reverse[fuzzy.target]) reverse[fuzzy.target] = normalized;
      eventBus.emit(Events.SERVICE_MESSAGE, { text: `Match [fuzzy] in ${Math.round(elapsed)}ms` });
      eventBus.emit(Events.PIPELINE_FINISHED, { method: 'fuzzy' });
      return createMatchResult(fuzzy);
    }
    if (traceId) _report(traceId, 'fuzzy_matching', { source: normalized, method: 'miss' }, performance.now() - startTime, normalized);
  }

  // Tier 3: LLM research — pass trace_id so backend adds to same trace
  const token = await findTokenMatch(normalized, traceId);
  const elapsed3 = ((performance.now() - startTime) / 1000).toFixed(1);
  if (token) {
    forward[normalized] = token.target;
    if (!reverse[token.target]) reverse[token.target] = normalized;
    const count = token.candidates?.length || 0;
    eventBus.emit(Events.SERVICE_MESSAGE, { text: `Research completed [ProfileRank] — ${count} candidate${count !== 1 ? 's' : ''} in ${elapsed3}s` });
    eventBus.emit(Events.PIPELINE_FINISHED, { method: 'ProfileRank' });
    return token;
  }

  eventBus.emit(Events.SERVICE_MESSAGE, { text: `No match in ${elapsed3}s` });
  eventBus.emit(Events.PIPELINE_FINISHED, { method: 'no_match' });
  return createMatchResult({ target: "No matches found", method: "no_match", confidence: 0, source: normalized });
}
