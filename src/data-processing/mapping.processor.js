// data-processing/mapping.processor.js
import * as XLSX from "xlsx";
import { findColumnIndex } from "../utils/column-utilities.js";

// Parameter validation
function validateParams(params) {
  if (!params.sheetName) throw new Error("Sheet name is required");
  if (!params.targetColumn) throw new Error("Target column is required");
  if (!params.useCurrentFile && !params.externalFile)
    throw new Error("External file required when not using current file");
  return params;
}

// Row processing helpers
function parseRow(row, srcIdx, tgtIdx) {
  const source = srcIdx >= 0 ? (row[srcIdx] || "").toString().trim() : "";
  const target = (row[tgtIdx] || "").toString().trim();
  return { source, target };
}

function classifyRow(source, target, hasSourceColumn) {
  if (!target && !source) return "bothEmpty";
  if (!target) return "referenceEmpty";
  if (!source && hasSourceColumn) return "aliasEmpty";
  return "valid";
}

function buildMetadata(mappings, rows, issues, emptyRows) {
  return {
    totalRows: rows.length,
    validMappings: Object.keys(mappings.forward).length,
    targets: Object.keys(mappings.reverse).length,
    issues: issues.length ? issues : null,
    emptyRows,
  };
}

// Streamlined mapping processor
export function processMappings(data, sourceColumn, targetColumn) {
  if (!data?.length || data.length < 2) {
    throw new Error("Need header row and at least one data row");
  }

  const [headers, ...rows] = data;
  const srcIdx = findColumnIndex(headers, sourceColumn);
  const tgtIdx = findColumnIndex(headers, targetColumn);

  if (sourceColumn && srcIdx === -1) throw new Error(`Source column "${sourceColumn}" not found`);
  if (tgtIdx === -1) throw new Error(`Target column "${targetColumn}" not found`);

  const mappings = { forward: {}, reverse: {} };
  const issues = [];
  const emptyRows = { aliasEmpty: [], referenceEmpty: [], bothEmpty: [] };
  const hasSourceColumn = srcIdx >= 0;

  for (const [i, row] of rows.entries()) {
    const { source, target } = parseRow(row, srcIdx, tgtIdx);
    const rowNumber = i + 2; // Excel row number (1-indexed + header)
    const rowType = classifyRow(source, target, hasSourceColumn);

    // Handle empty rows
    if (rowType !== "valid") {
      emptyRows[rowType].push(rowNumber);
      continue;
    }

    // Initialize reverse mapping if needed
    if (!mappings.reverse[target]) {
      mappings.reverse[target] = { alias: [] };
    }

    // Check for duplicates and build forward mapping only if source exists
    if (source) {
      if (mappings.forward[source]) {
        issues.push(`Row ${rowNumber}: Duplicate source "${source}"`);
        continue;
      }
      mappings.forward[source] = target;
      mappings.reverse[target].alias.push(source);
    }
  }

  return {
    ...mappings,
    metadata: buildMetadata(mappings, rows, issues, emptyRows),
  };
}

// Excel data loading functions (inlined from excel-integration.js)
async function loadCurrentWorksheetData(sheetName) {
  return await Excel.run(async (context) => {
    const range = context.workbook.worksheets.getItem(sheetName).getUsedRange(true);
    range.load("values");
    await context.sync();
    return range.values;
  });
}

async function loadExternalWorksheetData(file, sheetName) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  if (!workbook.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet "${sheetName}" not found in ${file.name}`);
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null });
}

async function loadWorksheetData({ useCurrentFile, sheetName, externalFile }) {
  return useCurrentFile
    ? await loadCurrentWorksheetData(sheetName)
    : await loadExternalWorksheetData(externalFile, sheetName);
}

// Main function - simplified (stateless backend)
export async function loadAndProcessMappings(customParams) {
  // Validate params, load data, process mappings
  const params = validateParams(customParams);
  const data = await loadWorksheetData(params);
  const result = processMappings(data, params.sourceColumn, params.targetColumn);

  // No backend sync needed - terms sent on-demand with each LLM request
  return result;
}
