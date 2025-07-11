// data-processing/mapping.processor.js
import { ExcelIntegration } from '../services/excel-integration.js';

export function processMappings(data, sourceColumn, targetColumn) {
    if (!data?.length || data.length < 2) throw new Error("Need header + data rows");
    
    const [headers, ...rows] = data;
    const srcIdx = sourceColumn ? headers.findIndex(h => h?.toString().trim().toLowerCase() === sourceColumn.trim().toLowerCase()) : -1;
    const tgtIdx = headers.findIndex(h => h?.toString().trim().toLowerCase() === targetColumn.trim().toLowerCase());
    
    if (sourceColumn && srcIdx === -1) throw new Error(`Source column "${sourceColumn}" not found`);
    if (tgtIdx === -1) throw new Error(`Target column "${targetColumn}" not found`);
    
    const forward = {};
    const reverse = {};
    const issues = [];
    
    rows.forEach((row, i) => {
        const source = srcIdx >= 0 ? (row[srcIdx] || '').toString().trim() : '';
        const target = (row[tgtIdx] || '').toString().trim();
        
        if (!target) return issues.push(`Row ${i + 2}: Empty target`);
        
        if (!source) {
            if (!reverse[target]) reverse[target] = { alias: [] };
            return;
        }
        
        if (forward[source]) return issues.push(`Row ${i + 2}: Duplicate source "${source}"`);
        
        forward[source] = target;
        if (!reverse[target]) reverse[target] = { alias: [] };
        reverse[target].alias.push(source);
    });

    return {
        forward,
        reverse,
        metadata: {
            totalRows: rows.length,
            validMappings: Object.keys(forward).length,
            targets: Object.keys(reverse).length,
            issues: issues.length ? issues : null
        }
    };
}

async function setupTokenMatcher(terms) {
    const API_BASE = 'http://127.0.0.1:8000';
    
    try {
        const response = await fetch(`${API_BASE}/setup-matcher`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ terms })
        });
        
        if (!response.ok) {
            throw new Error(`API call failed: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error('Failed to setup token matcher:', error);
        throw error;
    }
}

function getMappingParamsFromDOM() {
    return {
        useCurrentFile: document.getElementById('current-file')?.checked || false,
        sheetName: document.getElementById('worksheet-dropdown')?.value || '',
        sourceColumn: document.getElementById('source-column')?.value || null,
        targetColumn: document.getElementById('target-column')?.value || '',
        externalFile: window.externalFile || document.getElementById('external-file')?.files?.[0] || null
    };
}

export async function loadAndProcessMappings(customParams = null) {
    // Extract params from DOM if not provided, otherwise use custom params
    const params = customParams || getMappingParamsFromDOM();
    
    const { useCurrentFile, sheetName, sourceColumn, targetColumn, externalFile } = params;
    
    // Enhanced validation with better error messages
    if (!sheetName?.trim()) {
        throw new Error(`Sheet name required. Received: "${sheetName}". Check if worksheet dropdown element exists and has a value.`);
    }
    if (!targetColumn?.trim()) {
        throw new Error(`Target column required. Received: "${targetColumn}". Check if target-column element exists and has a value.`);
    }
    if (!useCurrentFile && !externalFile) {
        throw new Error(`External file required when not using current file. useCurrentFile: ${useCurrentFile}, externalFile: ${externalFile}`);
    }
    
    console.log('Processing mappings with params:', params);
    
    const excel = new ExcelIntegration();
    const data = await excel.loadWorksheetData({ useCurrentFile, sheetName, externalFile });
    
    const mappings = processMappings(data, sourceColumn, targetColumn);
    
    // Setup TokenLookupMatcher with keys from mappings.reverse
    const termList = Object.keys(mappings.reverse);
    const matcherSetup = await setupTokenMatcher(termList);
    
    return {
        ...mappings,
        matcherSetup
    };
}