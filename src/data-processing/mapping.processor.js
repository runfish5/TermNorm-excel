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
    // More robust parameter extraction with debugging
    const params = {};
    
    // Debug all checkboxes first
    const allCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
    console.log('All checkboxes found:', allCheckboxes.map(cb => ({
        id: cb.id,
        name: cb.name,
        className: cb.className,
        checked: cb.checked,
        value: cb.value
    })));
    
    // Try multiple selectors for useCurrentFile checkbox
    const currentFileElement = document.querySelector('input[name="currentFile"]') ||
                              document.querySelector('.current-file-checkbox') ||
                              document.querySelector('#current-file') ||
                              document.querySelector('[data-current-file]') ||
                              document.querySelector('input[type="checkbox"]');
    params.useCurrentFile = currentFileElement?.checked || false;
    
    console.log('Current file element found:', currentFileElement ? {
        id: currentFileElement.id,
        name: currentFileElement.name,
        className: currentFileElement.className,
        checked: currentFileElement.checked
    } : 'NOT FOUND');
    
    // Debug all select elements
    const allSelects = Array.from(document.querySelectorAll('select'));
    console.log('All select elements found:', allSelects.map(sel => ({
        id: sel.id,
        name: sel.name,
        className: sel.className,
        value: sel.value,
        options: Array.from(sel.options).map(opt => opt.value)
    })));
    
    // Try multiple selectors for worksheet dropdown
    const worksheetElement = document.querySelector('select[name="worksheet"]') ||
                            document.querySelector('#worksheet-dropdown') ||
                            document.querySelector('.worksheet-dropdown') ||
                            document.querySelector('[data-worksheet]') ||
                            document.querySelector('select');
    params.sheetName = worksheetElement?.value || '';
    
    // These should be more reliable with specific IDs
    params.sourceColumn = document.getElementById('source-column')?.value || null;
    params.targetColumn = document.getElementById('target-column')?.value || '';
    
    // Debug external file sources
    console.log('External file sources:');
    console.log('  window.externalFile:', window.externalFile);
    console.log('  File inputs:', Array.from(document.querySelectorAll('input[type="file"]')).map(inp => ({
        id: inp.id,
        name: inp.name,
        files: inp.files?.length || 0
    })));
    
    // External file from global scope or element
    params.externalFile = window.externalFile || 
                         document.querySelector('input[type="file"]')?.files?.[0] || 
                         null;
    
    console.log('Final extracted DOM params:', params);
    return params;
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