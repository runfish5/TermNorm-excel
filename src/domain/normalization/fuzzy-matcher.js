/**
 * Fuzzy Matcher - Pure domain logic for fuzzy string matching
 *
 * Extracted from normalizer.fuzzy.js to create a testable domain service.
 * Implements the second tier of the three-tier matching pipeline: Exact → Fuzzy → LLM
 *
 * Algorithm:
 * 1. Normalize text: lowercase, remove special chars, split into words
 * 2. Calculate word-level Levenshtein distance
 * 3. Find best matches above threshold
 *
 * Benefits:
 * - 100% testable (no dependencies)
 * - Reusable across contexts
 * - Clear separation of concerns
 */

/**
 * Normalize text for fuzzy matching
 *
 * Removes special characters, converts to lowercase, splits into words.
 * Preserves % symbol for percentage values.
 *
 * @param {string} text - Text to normalize
 * @returns {Array<string>} Normalized word array
 *
 * @example
 * normalizeText("ABC Inc."); // → ["abc", "inc"]
 * normalizeText("50% recycled"); // → ["50%", "recycled"]
 * normalizeText("  Multiple   Spaces  "); // → ["multiple", "spaces"]
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s%]/g, ' ') // Replace non-word chars (except %) with spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);
}

/**
 * Calculate Levenshtein distance between two strings
 *
 * Measures edit distance (insertions, deletions, substitutions).
 * Lower distance = more similar strings.
 *
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Edit distance
 *
 * @example
 * levenshteinDistance("kitten", "sitting"); // → 3
 * levenshteinDistance("abc", "abc"); // → 0
 * levenshteinDistance("abc", "xyz"); // → 3
 */
function levenshteinDistance(str1, str2) {
  const matrix = Array(str2.length + 1)
    .fill(null)
    .map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Calculate similarity score between two word arrays
 *
 * Finds best word-to-word matches using Levenshtein distance.
 * Each word in array1 is matched to the most similar word in array2.
 *
 * @param {Array<string>} words1 - First word array
 * @param {Array<string>} words2 - Second word array
 * @returns {number} Similarity score (0.0 - 1.0)
 *
 * @example
 * calculateSimilarity(["abc", "inc"], ["abc", "incorporated"]); // → ~0.8
 * calculateSimilarity(["same"], ["same"]); // → 1.0
 * calculateSimilarity([], []); // → 1.0 (both empty)
 * calculateSimilarity(["abc"], []); // → 0.0 (one empty)
 */
function calculateSimilarity(words1, words2) {
  if (words1.length === 0 && words2.length === 0) return 1;
  if (words1.length === 0 || words2.length === 0) return 0;

  let totalScore = 0;
  let matchedWords = new Set();

  // For each word in the first array, find the best match in the second array
  for (const word1 of words1) {
    let bestScore = 0;
    let bestIndex = -1;

    for (let i = 0; i < words2.length; i++) {
      if (matchedWords.has(i)) continue;

      const word2 = words2[i];
      const maxLen = Math.max(word1.length, word2.length);
      const distance = levenshteinDistance(word1, word2);
      const similarity = 1 - distance / maxLen;

      if (similarity > bestScore) {
        bestScore = similarity;
        bestIndex = i;
      }
    }

    if (bestIndex !== -1) {
      matchedWords.add(bestIndex);
      totalScore += bestScore;
    }
  }

  // Average similarity score
  return totalScore / Math.max(words1.length, words2.length);
}

/**
 * Fuzzy match query against multiple candidates
 *
 * Returns all candidates with similarity scores, sorted by best match first.
 *
 * @param {string} query - Query string to match
 * @param {Array<string>} candidates - Candidate strings to match against
 * @param {number} [threshold=0.6] - Minimum similarity threshold (0.0 - 1.0)
 * @returns {Array<Object>} Sorted array of {text, similarity, isMatch}
 *
 * @example
 * fuzzyMatch("ABC Inc", ["ABC Incorporated", "XYZ Corp"], 0.6);
 * // → [
 * //   { text: "ABC Incorporated", similarity: 0.85, isMatch: true },
 * //   { text: "XYZ Corp", similarity: 0.3, isMatch: false }
 * // ]
 */
export function fuzzyMatch(query, candidates, threshold = 0.6) {
  const queryWords = normalizeText(query);

  const results = candidates.map((candidate) => {
    const candidateWords = normalizeText(candidate);
    const similarity = calculateSimilarity(queryWords, candidateWords);

    return {
      text: candidate,
      similarity: similarity,
      isMatch: similarity >= threshold,
    };
  });

  // Sort by similarity score (highest first)
  return results.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Find best fuzzy match from mapping data
 *
 * Searches keys in mapping object/Map and returns best match above threshold.
 * Handles both plain objects and ES6 Maps.
 *
 * @param {string} query - Query string to match
 * @param {Object|Map} mappingData - Mapping object or Map
 * @param {number} [threshold=0.6] - Minimum similarity threshold (0.0 - 1.0)
 * @returns {Object|null} Match result {key, value, score} or null
 *
 * @example
 * const mapping = { "ABC Incorporated": "ABC Corp", "XYZ Ltd": "XYZ Company" };
 * findBestMatch("ABC Inc", mapping, 0.6);
 * // → { key: "ABC Incorporated", value: "ABC Corp", score: 0.85 }
 *
 * findBestMatch("Unknown", mapping, 0.6);
 * // → null (no match above threshold)
 */
export function findBestMatch(query, mappingData, threshold = 0.6) {
  if (!query || !mappingData) return null;

  // Handle both Maps and plain objects
  let candidates, getValue;

  if (mappingData instanceof Map) {
    if (mappingData.size === 0) return null;
    candidates = Array.from(mappingData.keys());
    getValue = (key) => mappingData.get(key);
  } else {
    // Plain object
    const keys = Object.keys(mappingData);
    if (keys.length === 0) return null;
    candidates = keys;
    getValue = (key) => mappingData[key];
  }

  const results = fuzzyMatch(query, candidates, threshold);

  if (results.length > 0 && results[0].isMatch) {
    return {
      key: results[0].text,
      value: getValue(results[0].text),
      score: results[0].similarity,
    };
  }

  return null;
}

/**
 * Find fuzzy match from forward or reverse mappings
 *
 * Implements second tier of three-tier pipeline.
 * Tries forward mapping first, then reverse mapping with different thresholds.
 *
 * @param {string} value - Value to match
 * @param {Object} forward - Forward mapping (source → target)
 * @param {Object} reverse - Reverse mapping (target → target)
 * @param {number} [forwardThreshold=0.7] - Threshold for forward mapping
 * @param {number} [reverseThreshold=0.5] - Threshold for reverse mapping (more lenient)
 * @returns {Object|null} Match result or null
 *
 * @example
 * const forward = { "ABC Incorporated": "ABC Corp" };
 * const reverse = { "ABC Corp": true };
 *
 * findFuzzyMatch("ABC Inc", forward, reverse);
 * // → { target: "ABC Corp", method: "fuzzy", confidence: 0.85, ... }
 */
export function findFuzzyMatch(value, forward, reverse, forwardThreshold = 0.7, reverseThreshold = 0.5) {
  if (!value) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  // Try forward mapping first (source → target)
  const fwd = findBestMatch(normalized, forward, forwardThreshold);
  if (fwd) {
    const target = typeof fwd.value === 'string' ? fwd.value : fwd.value.target;
    return {
      target,
      method: 'fuzzy',
      confidence: fwd.score,
      timestamp: new Date().toISOString(),
      source: normalized,
    };
  }

  // Try reverse mapping (target → target)
  const rev = findBestMatch(normalized, reverse, reverseThreshold);
  if (rev) {
    return {
      target: rev.key,
      method: 'fuzzy',
      confidence: rev.score,
      timestamp: new Date().toISOString(),
      source: normalized,
    };
  }

  return null;
}

/**
 * Get all fuzzy matches above threshold
 *
 * Returns all matches (not just best) that meet the threshold.
 * Useful for showing multiple candidates to user.
 *
 * @param {string} query - Query string
 * @param {Object|Map} mappingData - Mapping data
 * @param {number} [threshold=0.6] - Minimum similarity
 * @returns {Array<Object>} Array of {key, value, score}
 *
 * @example
 * getAllMatches("ABC", mapping, 0.6);
 * // → [
 * //   { key: "ABC Inc", value: "ABC Corp", score: 0.9 },
 * //   { key: "ABC Ltd", value: "ABC Company", score: 0.85 }
 * // ]
 */
export function getAllMatches(query, mappingData, threshold = 0.6) {
  if (!query || !mappingData) return [];

  let candidates, getValue;

  if (mappingData instanceof Map) {
    if (mappingData.size === 0) return [];
    candidates = Array.from(mappingData.keys());
    getValue = (key) => mappingData.get(key);
  } else {
    const keys = Object.keys(mappingData);
    if (keys.length === 0) return [];
    candidates = keys;
    getValue = (key) => mappingData[key];
  }

  const results = fuzzyMatch(query, candidates, threshold);

  return results
    .filter((r) => r.isMatch)
    .map((r) => ({
      key: r.text,
      value: getValue(r.text),
      score: r.similarity,
    }));
}
