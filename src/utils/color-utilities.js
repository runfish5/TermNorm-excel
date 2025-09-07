export function getRelevanceColor(score) {
  const s = score > 1 ? score / 100 : score;
  if (s >= 0.9) return "#C6EFCE";
  if (s >= 0.8) return "#FFEB9C";
  if (s >= 0.6) return "#FFD1A9";
  if (s >= 0.2) return "#FFC7CE";
  return "#E1E1E1";
}

export const PROCESSING_COLORS = {
  PENDING: "#FFFB9D",
  ERROR: "#FFC7CE",
  CLEAR: null,
};