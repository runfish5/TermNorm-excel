export function findColumnIndex(headers, columnName) {
  if (!columnName || !headers) return -1;
  return headers.findIndex((h) => h?.toString().trim().toLowerCase() === columnName.toLowerCase());
}

export function buildColumnMap(headers, columnMap, worksheetName = null) {
  const result = new Map(), missing = [];

  Object.entries(columnMap).forEach(([src, tgt]) => {
    const srcIdx = findColumnIndex(headers, src), tgtIdx = findColumnIndex(headers, tgt);
    if (srcIdx === -1) missing.push(`source "${src}"`);
    else if (tgtIdx === -1) missing.push(`target "${tgt}"`);
    else result.set(srcIdx, tgtIdx);
  });

  if (missing.length) {
    const ws = worksheetName ? ` in ${worksheetName}` : "";
    throw new Error(`Column headers not found${ws}: ${missing.join(", ")}. Check row 1 or update config.`);
  }
  return result;
}

export function buildConfidenceColumnMap(headers, confidenceColumnMap) {
  if (!confidenceColumnMap) return { map: new Map(), found: [], missing: [] };

  const map = new Map(), found = [], missing = [];

  Object.entries(confidenceColumnMap).forEach(([src, confCol]) => {
    const srcIdx = findColumnIndex(headers, src), confIdx = findColumnIndex(headers, confCol);
    if (srcIdx === -1 || confIdx === -1) missing.push(confIdx === -1 ? confCol : src);
    else { map.set(srcIdx, confIdx); found.push(`${src}→${confCol}`); }
  });

  return { map, found, missing };
}
