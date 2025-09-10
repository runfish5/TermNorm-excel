export function findColumnIndex(headers, columnName) {
  if (!columnName || !headers) return -1;
  return headers.findIndex((h) => h?.toString().trim().toLowerCase() === columnName.toLowerCase());
}

export function buildColumnMap(headers, columnMap) {
  const result = new Map();
  const missing = [];

  Object.entries(columnMap).forEach(([src, tgt]) => {
    const srcIdx = findColumnIndex(headers, src);
    const tgtIdx = findColumnIndex(headers, tgt);

    if (srcIdx === -1) missing.push(src);
    else if (tgtIdx === -1) missing.push(tgt);
    else result.set(srcIdx, tgtIdx);
  });

  if (missing.length > 0) {
    throw new Error(`Missing columns: ${missing.join(", ")}`);
  }

  return result;
}
