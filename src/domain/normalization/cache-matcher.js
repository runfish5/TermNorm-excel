/**
 * Cache Matcher - Pure domain logic for exact matching
 *
 * Extracted from normalizer.functions.js to eliminate dependencies on:
 * - state-machine.manager.js
 * - UI utilities
 * - Server APIs
 *
 * This is a pure, testable service that implements the first tier
 * of the three-tier matching pipeline: Exact → Fuzzy → LLM
 *
 * Benefits:
 * - 100% testable (no Office.js, no server, no state)
 * - Reusable across different contexts
 * - Clear separation of concerns
 */

/**
 * Normalize value to trimmed string (handles Excel cell types)
 *
 * @param {string|number|null} value - Raw value from Excel cell
 * @returns {string} Normalized string
 */
function normalizeValue(value) {
  return value ? String(value).trim() : '';
}

/**
 * Create match result object
 *
 * @param {string} source - Original source value
 * @param {string} target - Matched target identifier
 * @param {string} method - Match method (cached/fuzzy/ProfileRank)
 * @param {number} confidence - Confidence score (0.0-1.0)
 * @returns {Object} Match result
 */
function createMatchResult(source, target, method, confidence) {
  return {
    target,
    method,
    confidence,
    timestamp: new Date().toISOString(),
    source,
  };
}

/**
 * Get exact cached match from forward or reverse mappings
 *
 * This implements the first tier of the three-tier pipeline.
 * Returns exact matches with 100% confidence.
 *
 * Forward mapping: source → target (e.g., "ABC Inc" → "ABC Corporation")
 * Reverse mapping: target → target (e.g., "ABC Corporation" → "ABC Corporation")
 *
 * @param {string} value - Value to match
 * @param {Object} forward - Forward mapping (source → target)
 * @param {Object} reverse - Reverse mapping (target → target)
 * @returns {Object|null} Match result or null if no exact match found
 *
 * @example
 * const forward = { "ABC Inc": "ABC Corporation", "XYZ Ltd": { target: "XYZ Company" } };
 * const reverse = { "ABC Corporation": true, "XYZ Company": true };
 *
 * getCachedMatch("ABC Inc", forward, reverse);
 * // → { target: "ABC Corporation", method: "cached", confidence: 1.0, ... }
 *
 * getCachedMatch("ABC Corporation", forward, reverse);
 * // → { target: "ABC Corporation", method: "cached", confidence: 1.0, ... }
 *
 * getCachedMatch("Unknown", forward, reverse);
 * // → null
 */
export function getCachedMatch(value, forward, reverse) {
  const normalized = normalizeValue(value);
  if (!normalized) return null;

  // Check forward mapping first (source → target)
  if (normalized in forward) {
    const mapping = forward[normalized];
    const target = typeof mapping === 'string' ? mapping : mapping.target;

    return createMatchResult(normalized, target, 'cached', 1.0);
  }

  // Check reverse mapping (target → target)
  if (normalized in reverse) {
    return createMatchResult(normalized, normalized, 'cached', 1.0);
  }

  return null;
}

/**
 * Check if value has exact match in mappings
 *
 * Lightweight check without creating full match result object.
 * Useful for validation and conditional logic.
 *
 * @param {string} value - Value to check
 * @param {Object} forward - Forward mapping
 * @param {Object} reverse - Reverse mapping
 * @returns {boolean} True if exact match exists
 *
 * @example
 * hasExactMatch("ABC Inc", forward, reverse); // → true
 * hasExactMatch("Unknown", forward, reverse); // → false
 */
export function hasExactMatch(value, forward, reverse) {
  const normalized = normalizeValue(value);
  if (!normalized) return false;

  return (normalized in forward) || (normalized in reverse);
}

/**
 * Get all cached matches for multiple values
 *
 * Batch operation for efficiency. Returns Map with only matched values.
 *
 * @param {Array<string>} values - Values to match
 * @param {Object} forward - Forward mapping
 * @param {Object} reverse - Reverse mapping
 * @returns {Map<string, Object>} Map of value → match result (only matched values)
 *
 * @example
 * const values = ["ABC Inc", "Unknown", "XYZ Ltd"];
 * const matches = getCachedMatches(values, forward, reverse);
 * // → Map { "ABC Inc" => {...}, "XYZ Ltd" => {...} }
 * // Note: "Unknown" is not in the map (no match)
 */
export function getCachedMatches(values, forward, reverse) {
  const matches = new Map();

  for (const value of values) {
    const match = getCachedMatch(value, forward, reverse);
    if (match) {
      matches.set(value, match);
    }
  }

  return matches;
}

/**
 * Validate mappings structure
 *
 * Ensures mappings have the expected structure before matching.
 * Prevents runtime errors from malformed data.
 *
 * @param {Object} forward - Forward mapping to validate
 * @param {Object} reverse - Reverse mapping to validate
 * @returns {boolean} True if valid
 *
 * @example
 * validateMappings({ "ABC": "XYZ" }, { "XYZ": true }); // → true
 * validateMappings(null, {}); // → false
 * validateMappings("invalid", {}); // → false
 */
export function validateMappings(forward, reverse) {
  return (
    forward != null &&
    reverse != null &&
    typeof forward === 'object' &&
    typeof reverse === 'object'
  );
}
