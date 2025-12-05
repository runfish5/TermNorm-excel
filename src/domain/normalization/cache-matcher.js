/** Cache Matcher - First tier of three-tier pipeline: Exact → Fuzzy → LLM */

import { eventBus } from '../../core/event-bus.js';
import { Events } from '../../core/events.js';

function normalizeValue(value) { return value ? String(value).trim() : ''; }

function createMatchResult(source, target, method, confidence) {
  return { target, method, confidence, timestamp: new Date().toISOString(), source };
}

export function getCachedMatch(value, forward, reverse) {
  const normalized = normalizeValue(value);
  if (!normalized) return null;

  if (normalized in forward) {
    const mapping = forward[normalized];
    const target = typeof mapping === 'string' ? mapping : mapping.target;
    eventBus.emit(Events.CACHE_HIT, { source: normalized, target, mappingType: 'forward' });
    return createMatchResult(normalized, target, 'cached', 1.0);
  }

  if (normalized in reverse) {
    eventBus.emit(Events.CACHE_HIT, { source: normalized, target: normalized, mappingType: 'reverse' });
    return createMatchResult(normalized, normalized, 'cached', 1.0);
  }

  eventBus.emit(Events.CACHE_MISS, { source: normalized });
  return null;
}

// Exported for testing
export function hasExactMatch(value, forward, reverse) {
  const normalized = normalizeValue(value);
  return normalized ? (normalized in forward || normalized in reverse) : false;
}

// Exported for testing
export function getCachedMatches(values, forward, reverse) {
  const matches = new Map();
  for (const value of values) {
    const match = getCachedMatch(value, forward, reverse);
    if (match) matches.set(value, match);
  }
  return matches;
}

// Exported for testing
export function validateMappings(forward, reverse) {
  return forward != null && reverse != null && typeof forward === 'object' && typeof reverse === 'object';
}
