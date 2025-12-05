// data-processing/mapping.processor.js
import * as XLSX from "xlsx";
import { findColumnIndex } from "../utils/column-utilities.js";

function validateParams(params) {
  if (!params.sheetName) throw new Error("Sheet name is required");
  if (!params.targetColumn) throw new Error("Target column is required");
  if (!params.useCurrentFile && !params.externalFile) throw new Error("External file required when not using current file");
  return params;
}

export function processMappings(data, sourceColumn, targetColumn) {
  if (!data?.length || data.length < 2) throw new Error("Need header row and at least one data row");

  const [headers, ...rows] = data;
  const srcIdx = findColumnIndex(headers, sourceColumn);
  const tgtIdx = findColumnIndex(headers, targetColumn);

  if (sourceColumn && srcIdx === -1) throw new Error(`Source column "${sourceColumn}" not found`);
  if (tgtIdx === -1) throw new Error(`Target column "${targetColumn}" not found`);

  const mappings = { forward: {}, reverse: {} };
  const issues = [], emptyRows = { aliasEmpty: [], referenceEmpty: [], bothEmpty: [] };

  for (const [i, row] of rows.entries()) {
    const source = srcIdx >= 0 ? (row[srcIdx] || "").toString().trim() : "";
    const target = (row[tgtIdx] || "").toString().trim();
    const rowNum = i + 2;

    if (!target && !source) { emptyRows.bothEmpty.push(rowNum); continue; }
    if (!target) { emptyRows.referenceEmpty.push(rowNum); continue; }
    if (!source && srcIdx >= 0) { emptyRows.aliasEmpty.push(rowNum); continue; }

    if (!mappings.reverse[target]) mappings.reverse[target] = { alias: [] };
    if (source) {
      if (mappings.forward[source]) { issues.push(`Row ${rowNum}: Duplicate source "${source}"`); continue; }
      mappings.forward[source] = target;
      mappings.reverse[target].alias.push(source);
    }
  }

  return { ...mappings, metadata: { totalRows: rows.length, validMappings: Object.keys(mappings.forward).length, targets: Object.keys(mappings.reverse).length, issues: issues.length ? issues : null, emptyRows } };
}

async function loadWorksheetData({ useCurrentFile, sheetName, externalFile }) {
  if (useCurrentFile) {
    return Excel.run(async (ctx) => { const range = ctx.workbook.worksheets.getItem(sheetName).getUsedRange(true); range.load("values"); await ctx.sync(); return range.values; });
  }
  const workbook = XLSX.read(await externalFile.arrayBuffer(), { type: "array" });
  if (!workbook.SheetNames.includes(sheetName)) throw new Error(`Sheet "${sheetName}" not found in ${externalFile.name}`);
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null });
}

export async function loadAndProcessMappings(customParams) {
  const params = validateParams(customParams);
  return processMappings(await loadWorksheetData(params), params.sourceColumn, params.targetColumn);
}
