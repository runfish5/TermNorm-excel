/** Matchers - Three-tier pipeline: Cache (exact) → Fuzzy → LLM */
import { FUZZY_THRESHOLDS } from "../config/config.js";

// Cache Matcher (merged from cache-matcher.js)
const norm = v => v ? String(v).trim() : '';
const cacheResult = (source, target) => ({ target, method: 'cached', confidence: 1.0, timestamp: new Date().toISOString(), source });

export function getCachedMatch(value, forward, reverse) {
  const n = norm(value);
  if (!n) return null;
  if (n in forward) return cacheResult(n, typeof forward[n] === 'string' ? forward[n] : forward[n].target);
  if (n in reverse) return cacheResult(n, n);
  return null;
}

// Fuzzy Matcher

function normalizeText(text) {
  return text.toLowerCase().replace(/[^\w\s%]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(w => w.length > 0);
}

function levenshteinDistance(str1, str2) {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + (str1[i - 1] === str2[j - 1] ? 0 : 1)
      );
    }
  }
  return matrix[str2.length][str1.length];
}

function calculateSimilarity(words1, words2) {
  if (!words1.length && !words2.length) return 1;
  if (!words1.length || !words2.length) return 0;

  let totalScore = 0, matchedWords = new Set();

  for (const word1 of words1) {
    let bestScore = 0, bestIndex = -1;
    for (let i = 0; i < words2.length; i++) {
      if (matchedWords.has(i)) continue;
      const similarity = 1 - levenshteinDistance(word1, words2[i]) / Math.max(word1.length, words2[i].length);
      if (similarity > bestScore) { bestScore = similarity; bestIndex = i; }
    }
    if (bestIndex !== -1) { matchedWords.add(bestIndex); totalScore += bestScore; }
  }
  return totalScore / Math.max(words1.length, words2.length);
}

function fuzzyMatch(query, candidates, threshold = FUZZY_THRESHOLDS.DEFAULT) {
  const queryWords = normalizeText(query);
  return candidates
    .map(c => { const similarity = calculateSimilarity(queryWords, normalizeText(c)); return { text: c, similarity, isMatch: similarity >= threshold }; })
    .sort((a, b) => b.similarity - a.similarity);
}

function findBestMatch(query, mappingData, threshold = FUZZY_THRESHOLDS.DEFAULT) {
  if (!query || !mappingData) return null;

  const isMap = mappingData instanceof Map;
  const candidates = isMap ? Array.from(mappingData.keys()) : Object.keys(mappingData);
  if (!candidates.length) return null;

  const getValue = isMap ? k => mappingData.get(k) : k => mappingData[k];
  const results = fuzzyMatch(query, candidates, threshold);

  return results.length && results[0].isMatch
    ? { key: results[0].text, value: getValue(results[0].text), score: results[0].similarity }
    : null;
}

export function findFuzzyMatch(value, forward, reverse, forwardThreshold = FUZZY_THRESHOLDS.FORWARD, reverseThreshold = FUZZY_THRESHOLDS.REVERSE) {
  const normalized = value ? String(value).trim() : '';
  if (!normalized) return null;

  const fwd = findBestMatch(normalized, forward, forwardThreshold);
  if (fwd) {
    const target = typeof fwd.value === 'string' ? fwd.value : fwd.value.target;
    return { target, method: 'fuzzy', confidence: fwd.score, timestamp: new Date().toISOString(), source: normalized, matched_key: fwd.key, direction: 'forward' };
  }

  const rev = findBestMatch(normalized, reverse, reverseThreshold);
  if (rev) return { target: rev.key, method: 'fuzzy', confidence: rev.score, timestamp: new Date().toISOString(), source: normalized, matched_key: rev.key, direction: 'reverse' };

  return null;
}
