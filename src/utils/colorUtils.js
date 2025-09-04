// utils/colorUtils.js

/**
 * Get color for relevance score with consistent mapping
 * @param {number} score - Relevance score (0-1 or 0-100)
 * @returns {string} Hex color code
 */
export function getRelevanceColor(score) {
  const s = score > 1 ? score / 100 : score;
  if (s >= 0.9) return "#C6EFCE"; // High confidence - light green
  if (s >= 0.8) return "#FFEB9C"; // Good - light yellow
  if (s >= 0.6) return "#FFD1A9"; // Medium - light orange
  if (s >= 0.2) return "#FFC7CE"; // Low - light red
  return "#E1E1E1"; // No confidence - light gray
}

/**
 * Get processing state colors
 */
export const PROCESSING_COLORS = {
  PENDING: "#FFFB9D", // Light yellow for pending
  ERROR: "#FFC7CE", // Light red for errors
  CLEAR: null, // Clear formatting
};
