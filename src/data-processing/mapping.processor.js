// data-processing/mapping.processor.js
import * as XLSX from "xlsx";
import { state } from "../shared-services/state.manager.js";
// Inlined column utility
function findColumnIndex(headers, columnName) {
  if (!columnName || !headers) return -1;
  return headers.findIndex((h) => h?.toString().trim().toLowerCase() === columnName.toLowerCase());
}
import { getHost, getHeaders } from "../utils/server-utilities.js";

// Parameter validation
function validateParams(params) {
  // Validate required fields
  if (!params.sheetName) throw new Error("Sheet name is required");
  if (!params.targetColumn) throw new Error("Target column is required");
  if (!params.useCurrentFile && !params.externalFile)
    throw new Error("External file required when not using current file");

  return params;
}

// Streamlined mapping processor
export function processMappings(data, sourceColumn, targetColumn) {
  if (!data?.length || data.length < 2) {
    throw new Error("Need header row and at least one data row");
  }

  const [headers, ...rows] = data;
  const srcIdx = findColumnIndex(headers, sourceColumn);
  const tgtIdx = findColumnIndex(headers, targetColumn);

  // Validate columns exist
  if (sourceColumn && srcIdx === -1) throw new Error(`Source column "${sourceColumn}" not found`);
  if (tgtIdx === -1) throw new Error(`Target column "${targetColumn}" not found`);

  // Build mappings in one pass
  const mappings = { forward: {}, reverse: {} };
  const issues = [];

  for (const [i, row] of rows.entries()) {
    const source = srcIdx >= 0 ? (row[srcIdx] || "").toString().trim() : "";
    const target = (row[tgtIdx] || "").toString().trim();

    if (!target) {
      issues.push(`Row ${i + 2}: Empty target`);
      continue;
    }

    // Initialize reverse mapping
    if (!mappings.reverse[target]) {
      mappings.reverse[target] = { alias: [] };
    }

    // Handle source mapping
    if (source) {
      if (mappings.forward[source]) {
        issues.push(`Row ${i + 2}: Duplicate source "${source}"`);
        continue;
      }
      mappings.forward[source] = target;
      mappings.reverse[target].alias.push(source);
    }
  }

  return {
    ...mappings,
    metadata: {
      totalRows: rows.length,
      validMappings: Object.keys(mappings.forward).length,
      targets: Object.keys(mappings.reverse).length,
      issues: issues.length ? issues : null,
    },
  };
}

// Simplified token matcher update with timeout and error handling
async function updateTokenMatcher(terms) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

  try {
    const response = await fetch(`${getHost()}/update-matcher`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ terms }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Token matcher failed: ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    let errorMessage = "❌ Connection failed: " + error.message;
    if (error.name === "AbortError") {
      errorMessage = "Backend server timeout - ensure server is running on port 8000";
    } else if (error.message.includes("fetch") || error.message.includes("Failed to fetch")) {
      errorMessage = "Backend server not accessible - ensure server is running on port 8000";
    }
    throw new Error(errorMessage);
  }
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

// Main function - much simpler
export async function loadAndProcessMappings(customParams) {
  try {
    state.setStatus("Loading mappings...");

    // Validate params, load data, process mappings
    const params = validateParams(customParams);
    const data = await loadWorksheetData(params);
    const result = processMappings(data, params.sourceColumn, params.targetColumn);

    // Try to update matcher, but don't fail if server unavailable
    try {
      await updateTokenMatcher(Object.keys(result.reverse));
    } catch (error) {
      console.warn("Token matcher update failed:", error.message);
      // Add server connectivity warning to result metadata
      if (result.metadata) {
        result.metadata.serverWarning = error.message;
      }
    }

    // Return result - let caller handle state management
    return result;
  } catch (error) {
    state.setStatus(`Failed: ${error.message}`, true);
    state.clearMappings();
    throw error;
  }
}
