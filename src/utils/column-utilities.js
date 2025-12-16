export function findColumnIndex(headers, columnName) {
  if (!columnName || !headers) return -1;
  return headers.findIndex((h) => h?.toString().trim().toLowerCase() === columnName.toLowerCase());
}

/**
 * Build column index mapping from header names to column indices
 * @param {string[]} headers - Header row values
 * @param {Object<string, {output: string, confidence?: string}>} columnMap - Config mapping {sourceColumn: {output, confidence?}}
 * @param {string} [worksheetName=null] - Worksheet name for error messages
 * @returns {Map<number, number>} Map of sourceColumnIndex → targetColumnIndex
 * @throws {Error} If any column headers not found
 */
export function buildColumnMap(headers, columnMap, worksheetName = null) {
  const result = new Map(), missing = [];

  Object.entries(columnMap).forEach(([src, mapping]) => {
    const output = mapping.output;
    const srcIdx = findColumnIndex(headers, src), tgtIdx = findColumnIndex(headers, output);
    if (srcIdx === -1) missing.push(`source "${src}"`);
    else if (tgtIdx === -1) missing.push(`target "${output}"`);
    else result.set(srcIdx, tgtIdx);
  });

  if (missing.length) {
    const ws = worksheetName ? ` in ${worksheetName}` : "";
    throw new Error(`Column headers not found${ws}: ${missing.join(", ")}. Check row 1 or update config.`);
  }
  return result;
}

/**
 * Build confidence column index mapping (optional columns, no errors on missing)
 * @param {string[]} headers - Header row values
 * @param {Object<string, {output: string, confidence?: string}>} columnMap - Config mapping {sourceColumn: {output, confidence?}}
 * @returns {{confidenceColumnMap: Map<number, number>, confidenceFound: string[], confidenceMissing: string[]}}
 */
export function buildConfidenceColumnMap(headers, columnMap) {
  if (!columnMap) return { confidenceColumnMap: new Map(), confidenceFound: [], confidenceMissing: [] };

  const map = new Map(), found = [], missing = [];

  Object.entries(columnMap).forEach(([src, mapping]) => {
    const confCol = mapping.confidence;
    if (!confCol) return; // confidence column is optional
    const srcIdx = findColumnIndex(headers, src), confIdx = findColumnIndex(headers, confCol);
    if (srcIdx === -1 || confIdx === -1) missing.push(confIdx === -1 ? confCol : src);
    else { map.set(srcIdx, confIdx); found.push(`${src}→${confCol}`); }
  });

  return { confidenceColumnMap: map, confidenceFound: found, confidenceMissing: missing };
}
