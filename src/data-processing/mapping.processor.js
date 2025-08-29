// data-processing/mapping.processor.js
import { ExcelIntegration } from "../services/excel-integration.js";
import { state } from "../shared-services/state.manager.js";

// Combined parameter extraction and validation
function getValidatedParams(customParams) {
  // Use custom params or extract from DOM
  const params = customParams || {
    useCurrentFile: document.getElementById("current-file")?.checked || false,
    sheetName: document.getElementById("worksheet-dropdown")?.value?.trim() || "",
    sourceColumn: document.getElementById("source-column")?.value?.trim() || null,
    targetColumn: document.getElementById("target-column")?.value?.trim() || "",
    externalFile: window.externalFile || document.getElementById("external-file")?.files?.[0] || null,
  };

  // Validate required fields
  if (!params.sheetName) throw new Error("Sheet name is required");
  if (!params.targetColumn) throw new Error("Target column is required");
  if (!params.useCurrentFile && !params.externalFile)
    throw new Error("External file required when not using current file");

  return params;
}

// Simplified column finder
function findColumn(headers, columnName) {
  return columnName ? headers.findIndex((h) => h?.toString().trim().toLowerCase() === columnName.toLowerCase()) : -1;
}

// Streamlined mapping processor
export function processMappings(data, sourceColumn, targetColumn) {
  if (!data?.length || data.length < 2) {
    throw new Error("Need header row and at least one data row");
  }

  const [headers, ...rows] = data;
  const srcIdx = findColumn(headers, sourceColumn);
  const tgtIdx = findColumn(headers, targetColumn);

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
    const response = await fetch("http://127.0.0.1:8000/update-matcher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

    if (error.name === "AbortError") {
      throw new Error("Backend server timeout - ensure server is running on port 8000");
    } else if (error.message.includes("fetch") || error.message.includes("Failed to fetch")) {
      throw new Error("Backend server not accessible - ensure server is running on port 8000");
    }
    throw error;
  }
}

// Main function - much simpler
export async function loadAndProcessMappings(customParams = null) {
  try {
    state.setStatus("Loading mappings...");

    // Get params, load data, process mappings
    const params = getValidatedParams(customParams);
    const excel = new ExcelIntegration();
    const data = await excel.loadWorksheetData(params);
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

    state.mergeMappings(result.forward, result.reverse, result.metadata);

    // Simple status message with server warning if applicable
    const { validMappings, issues, serverWarning } = result.metadata;
    let statusMsg = issues
      ? `Loaded ${validMappings} mappings (${issues.length} issues)`
      : `Loaded ${validMappings} mappings`;

    if (serverWarning) {
      statusMsg += ` - Server unavailable`;
    }

    state.setStatus(statusMsg, !!serverWarning);
    if (issues) console.warn("Issues:", issues);

    return result;
  } catch (error) {
    state.setStatus(`Failed: ${error.message}`, true);
    state.clearMappings();
    throw error;
  }
}
