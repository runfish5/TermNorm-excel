import { LIMITS } from "../config/config.js";

export function findColumnIndex(headers, columnName) {
  if (!columnName || !headers) return -1;
  return headers.findIndex((h) => h?.toString().trim().toLowerCase() === columnName.toLowerCase());
}

/**
 * Build column index mapping from header names to column indices
 * @param {string[]} headers - Header row values
 * @param {Object<string, {output: string, confidence?: string}>} columnMap - Config mapping {sourceColumn: {output, confidence?}}
 * @returns {{columnMap: Map<number, number>, missingRequired: string[]}}
 */
export function buildColumnMap(headers, columnMap) {
  const result = new Map(), missing = [];

  Object.entries(columnMap).forEach(([src, mapping]) => {
    const srcIdx = findColumnIndex(headers, src), tgtIdx = findColumnIndex(headers, mapping.output);
    if (srcIdx === -1) missing.push(`source "${src}"`);
    if (tgtIdx === -1) missing.push(`target "${mapping.output}"`);
    if (srcIdx !== -1 && tgtIdx !== -1) result.set(srcIdx, tgtIdx);
  });

  return { columnMap: result, missingRequired: missing };
}

/**
 * Build confidence column index mapping (optional columns)
 * @param {string[]} headers - Header row values
 * @param {Object<string, {output: string, confidence?: string}>} columnMap - Config mapping {sourceColumn: {output, confidence?}}
 * @returns {{confidenceColumnMap: Map<number, number>, confidenceFound: string[], confidenceMissing: string[]}}
 */
export function buildConfidenceColumnMap(headers, columnMap) {
  if (!columnMap) return { confidenceColumnMap: new Map(), confidenceFound: [], confidenceMissing: [] };

  const map = new Map(), found = [], missing = [];

  Object.entries(columnMap).forEach(([src, mapping]) => {
    const confCol = mapping.confidence;
    if (!confCol) return;
    const srcIdx = findColumnIndex(headers, src), confIdx = findColumnIndex(headers, confCol);
    if (srcIdx === -1 || confIdx === -1) missing.push(confIdx === -1 ? confCol : src);
    else { map.set(srcIdx, confIdx); found.push(`${src}→${confCol}`); }
  });

  return { confidenceColumnMap: map, confidenceFound: found, confidenceMissing: missing };
}

/**
 * Read Excel headers and build column maps in a single sync round-trip
 * @param {Excel.Worksheet} ws - Active worksheet
 * @param {Excel.RequestContext} ctx - Request context
 * @param {Object} columnConfig - Config with column_map
 * @param {string} [worksheetName] - For error messages
 * @returns {Promise<{headerNames: string[], columnMap: Map, confidenceColumnMap: Map, confidenceFound: string[], confidenceMissing: string[]}>}
 * @throws {Error} If any required column headers not found
 */
export async function resolveColumnMaps(ws, ctx, columnConfig, worksheetName) {
  const headers = ws.getRangeByIndexes(0, 0, 1, LIMITS.MAX_HEADER_COLUMNS);
  headers.load("values");
  await ctx.sync();
  const headerNames = headers.values[0].map(h => String(h || "").trim());

  const { columnMap, missingRequired } = buildColumnMap(headerNames, columnConfig.column_map);
  const { confidenceColumnMap, confidenceFound, confidenceMissing } = buildConfidenceColumnMap(headerNames, columnConfig.column_map);

  if (missingRequired.length || confidenceMissing.length) {
    const loc = worksheetName ? ` in ${worksheetName}` : "";
    const parts = [];
    if (missingRequired.length) parts.push(`Required: ${missingRequired.join(", ")}`);
    if (confidenceMissing.length) parts.push(`Optional (confidence): ${confidenceMissing.map(c => `"${c}"`).join(", ")}`);
    throw new Error(`Column headers not found${loc} — ${parts.join(". ")}. Check row 1 or update config.`);
  }

  return { headerNames, columnMap, confidenceColumnMap, confidenceFound, confidenceMissing };
}
