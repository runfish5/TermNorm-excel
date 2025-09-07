export function createCellKey(row, col) {
  return `${row}:${col}`;
}

export function hasValueChanged(cellValues, cellKey, newValue) {
  const oldValue = cellValues.get(cellKey);
  return oldValue !== newValue;
}

export function cleanCellValue(value) {
  return String(value || "").trim();
}