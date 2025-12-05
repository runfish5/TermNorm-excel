/** Cache Matcher - First tier of three-tier pipeline: Exact → Fuzzy → LLM */
import { eventBus } from '../../core/event-bus.js';
import { Events } from '../../core/events.js';

const normalize = (v) => v ? String(v).trim() : '';
const result = (source, target) => ({ target, method: 'cached', confidence: 1.0, timestamp: new Date().toISOString(), source });

export function getCachedMatch(value, forward, reverse) {
  const n = normalize(value);
  if (!n) return null;

  if (n in forward) {
    const target = typeof forward[n] === 'string' ? forward[n] : forward[n].target;
    eventBus.emit(Events.CACHE_HIT, { source: n, target, mappingType: 'forward' });
    return result(n, target);
  }
  if (n in reverse) {
    eventBus.emit(Events.CACHE_HIT, { source: n, target: n, mappingType: 'reverse' });
    return result(n, n);
  }
  eventBus.emit(Events.CACHE_MISS, { source: n });
  return null;
}

export function hasExactMatch(value, forward, reverse) {
  const n = normalize(value);
  return n ? (n in forward || n in reverse) : false;
}

export function getCachedMatches(values, forward, reverse) {
  const matches = new Map();
  for (const v of values) { const m = getCachedMatch(v, forward, reverse); if (m) matches.set(v, m); }
  return matches;
}

export function validateMappings(forward, reverse) {
  return forward != null && reverse != null && typeof forward === 'object' && typeof reverse === 'object';
}
