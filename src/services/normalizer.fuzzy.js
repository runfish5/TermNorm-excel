// ./services/normalizer.fuzzy.js

// Normalize text by removing special characters, converting to lowercase, and splitting into words
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s%]/g, " ") // Replace non-word chars (except %) with spaces
    .replace(/\s+/g, " ") // Collapse multiple spaces
    .trim()
    .split(" ")
    .filter((word) => word.length > 0);
}

// Calculate Levenshtein distance between two strings
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

// Calculate similarity score between two word arrays
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

// Main fuzzy matching function
function fuzzyMatch(query, candidates, threshold = 0.6) {
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

// Find best match from either a Map or plain object
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
      score: results[0].similarity, // Changed from 'similarity' to 'score' to match your ValueProcessor expectations
    };
  }

  return null;
}

// Export the main function for other uses
export { fuzzyMatch };
