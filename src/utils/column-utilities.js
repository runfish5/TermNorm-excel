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
