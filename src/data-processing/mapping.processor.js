// data-processing/mapping.processor.js
import { ExcelIntegration } from '../services/excel-integration.js';
import { state } from '../shared-services/state.manager.js';

// Simplified parameter extraction with defaults
function extractMappingParams(customParams) {
    if (customParams) return customParams;
    
    const elements = {
        useCurrentFile: document.getElementById('current-file'),
        sheetName: document.getElementById('worksheet-dropdown'),
        sourceColumn: document.getElementById('source-column'),
        targetColumn: document.getElementById('target-column'),
        externalFile: document.getElementById('external-file')
    };
    
    return {
        useCurrentFile: elements.useCurrentFile?.checked || false,
        sheetName: elements.sheetName?.value?.trim() || '',
        sourceColumn: elements.sourceColumn?.value?.trim() || null,
        targetColumn: elements.targetColumn?.value?.trim() || '',
        externalFile: window.externalFile || elements.externalFile?.files?.[0] || null
    };
}

// Simplified validation with clear error messages
function validateParams({ useCurrentFile, sheetName, targetColumn, externalFile }) {
    if (!sheetName) throw new Error('Sheet name is required');
    if (!targetColumn) throw new Error('Target column is required');
    if (!useCurrentFile && !externalFile) throw new Error('External file required when not using current file');
}

// Simplified column finder
function findColumn(headers, columnName) {
    if (!columnName) return -1;
    return headers.findIndex(h => 
        h?.toString().trim().toLowerCase() === columnName.toLowerCase()
    );
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
        const source = srcIdx >= 0 ? (row[srcIdx] || '').toString().trim() : '';
        const target = (row[tgtIdx] || '').toString().trim();
        const rowNum = i + 2; // Header is row 1
        
        if (!target) {
            issues.push(`Row ${rowNum}: Empty target`);
            continue;
        }
        
        // Initialize reverse mapping
        if (!mappings.reverse[target]) {
            mappings.reverse[target] = { alias: [] };
        }
        
        // Handle source mapping
        if (source) {
            if (mappings.forward[source]) {
                issues.push(`Row ${rowNum}: Duplicate source "${source}"`);
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
            issues: issues.length ? issues : null
        }
    };
}

// Simplified API call with better error handling
async function setupTokenMatcher(terms) {
    const response = await fetch('http://127.0.0.1:8000/setup-matcher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms })
    });
    
    if (!response.ok) {
        throw new Error(`Token matcher setup failed: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
}

// Main orchestration function - broken into clear steps
export async function loadAndProcessMappings(customParams = null) {
    state.setStatus('Starting mapping process...');
    
    try {
        // Step 1: Get and validate parameters
        const params = extractMappingParams(customParams);
        validateParams(params);
        console.log('Mapping parameters:', params);
        
        // Step 2: Load data
        state.setStatus('Loading worksheet data...');
        const excel = new ExcelIntegration();
        const data = await excel.loadWorksheetData(params);
        
        // Step 3: Process mappings
        state.setStatus('Processing mappings...');
        const result = processMappings(data, params.sourceColumn, params.targetColumn);
        
        // Step 4: Setup token matcher
        state.setStatus('Configuring token matcher...');
        const matcherSetup = await setupTokenMatcher(Object.keys(result.reverse));
        
        // Step 5: Update state and complete
        state.setMappings(result.forward, result.reverse, result.metadata);
        
        const { validMappings, targets, issues } = result.metadata;
        const statusMsg = issues 
            ? `Loaded ${validMappings} mappings with ${issues.length} issues`
            : `Loaded ${validMappings} mappings to ${targets} targets`;
        
        state.setStatus(statusMsg);
        if (issues) console.warn('Mapping issues:', issues);
        
        return { ...result, matcherSetup };
        
    } catch (error) {
        state.setStatus(`Mapping failed: ${error.message}`, true);
        state.clearMappings();
        throw error;
    }
}