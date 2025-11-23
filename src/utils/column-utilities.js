export function findColumnIndex(headers, columnName) {
  if (!columnName || !headers) return -1;
  return headers.findIndex((h) => h?.toString().trim().toLowerCase() === columnName.toLowerCase());
}

export function buildColumnMap(headers, columnMap, worksheetName = null) {
  const result = new Map();
  const missingSources = [];
  const missingTargets = [];

  Object.entries(columnMap).forEach(([src, tgt]) => {
    const srcIdx = findColumnIndex(headers, src);
    const tgtIdx = findColumnIndex(headers, tgt);

    if (srcIdx === -1) missingSources.push(src);
    else if (tgtIdx === -1) missingTargets.push(tgt);
    else result.set(srcIdx, tgtIdx);
  });

  if (missingSources.length > 0 || missingTargets.length > 0) {
    // Build concise error message
    const worksheetInfo = worksheetName ? ` (worksheet: ${worksheetName})` : "";
    const configuredMappings = Object.entries(columnMap)
      .map(([src, tgt]) => `    • ${src} → ${tgt}`)
      .join("\n");

    let errorParts = [`❌ Cannot find required column headers in your Excel worksheet${worksheetInfo}:\n`];
    errorParts.push(`Your config expects these column mappings:`);
    errorParts.push(configuredMappings);
    errorParts.push(`\nNote: Check column headers in row 1 or update column_map in your config file.`);

    throw new Error(errorParts.join("\n"));
  }

  return result;
}

/**
 * Build confidence column mapping (input column → confidence column)
 * @param {string[]} headers - Excel column headers
 * @param {Object} confidenceColumnMap - Mapping from input column name to confidence column name
 * @param {string} worksheetName - Optional worksheet name for error messages
 * @returns {Map<number, number>} Map from input column index to confidence column index
 */
export function buildConfidenceColumnMap(headers, confidenceColumnMap, worksheetName = null) {
  if (!confidenceColumnMap) return new Map();

  const result = new Map();
  const missingSources = [];
  const missingConfidenceColumns = [];

  Object.entries(confidenceColumnMap).forEach(([src, confCol]) => {
    const srcIdx = findColumnIndex(headers, src);
    const confIdx = findColumnIndex(headers, confCol);

    if (srcIdx === -1) {
      missingSources.push(src);
    } else if (confIdx === -1) {
      missingConfidenceColumns.push(confCol);
    } else {
      result.set(srcIdx, confIdx);
    }
  });

  // Only throw error if there are missing columns (optional feature, so we're lenient)
  if (missingSources.length > 0 || missingConfidenceColumns.length > 0) {
    const worksheetInfo = worksheetName ? ` (worksheet: ${worksheetName})` : "";
    console.warn(
      `⚠️ Some confidence columns not found in worksheet${worksheetInfo}:\n` +
        (missingSources.length > 0 ? `  Missing source columns: ${missingSources.join(", ")}\n` : "") +
        (missingConfidenceColumns.length > 0
          ? `  Missing confidence columns: ${missingConfidenceColumns.join(", ")}\n`
          : "") +
        `Confidence values will not be written for these columns.`
    );
  }

  return result;
}
