// services/excel-integration.js
import * as XLSX from 'xlsx';

export class ExcelIntegration {
    constructor() {
        this.cachedWorkbook = null;
        this.cachedFileName = null;
        this.cloudCache = new Map(); // Cache for cloud files
    }

    async getCurrentWorksheetNames() {
        return await Excel.run(async (context) => {
            const worksheets = context.workbook.worksheets;
            worksheets.load("items/name");
            await context.sync();
            return worksheets.items.map(ws => ws.name);
        });
    }

    async getExternalWorksheetNames(file) {
        const workbook = await this.loadExternalWorkbook(file);
        return workbook.SheetNames;
    }

    async loadExternalWorkbook(file) {
        if (this.cachedWorkbook && this.cachedFileName === file.name) {
            return this.cachedWorkbook;
        }
        
        const buffer = await file.arrayBuffer();
        this.cachedWorkbook = XLSX.read(buffer, { type: 'array' });
        this.cachedFileName = file.name;
        return this.cachedWorkbook;
    }

    async loadExternalWorksheetData(file, sheetName) {
        const workbook = await this.loadExternalWorkbook(file);
        
        if (!workbook.SheetNames.includes(sheetName)) {
            throw new Error(`Sheet "${sheetName}" not found in ${file.name}`);
        }
        
        return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null });
    }
    
    async loadCurrentWorksheetData(sheetName) {
        return await Excel.run(async (context) => {
            const range = context.workbook.worksheets.getItem(sheetName).getUsedRange(true);
            range.load("values");
            await context.sync();
            return range.values;
        });
    }

    
    async loadCloudWorkbook(url) {
        if (this.cloudCache.has(url)) {
            return this.cloudCache.get(url);
        }
        
        try {
            // For cloud files, we need to fetch them through a proxy or API
            // Since direct CORS access to SharePoint/OneDrive is restricted
            const response = await fetch('http://127.0.0.1:8000/fetch-cloud-file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch cloud file: ${response.statusText}`);
            }
            
            const buffer = await response.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            this.cloudCache.set(url, workbook);
            return workbook;
        } catch (error) {
            console.error('Cloud file fetch error:', error);
            throw new Error(`Could not load cloud file: ${error.message}`);
        }
    }

    async getCloudWorksheetNames(url) {
        const workbook = await this.loadCloudWorkbook(url);
        return workbook.SheetNames;
    }

    async loadCloudWorksheetData(url, sheetName) {
        const workbook = await this.loadCloudWorkbook(url);
        
        if (!workbook.SheetNames.includes(sheetName)) {
            throw new Error(`Sheet "${sheetName}" not found in cloud file`);
        }
        
        return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null });
    }

    async loadWorksheetData({ useCurrentFile, sheetName, externalFile, cloudFileUrl, fileType }) {
        if (!sheetName?.trim()) throw new Error("Sheet name is required");
        
        if (useCurrentFile) {
            return await this.loadCurrentWorksheetData(sheetName);
        } else if (fileType === 'cloud' && cloudFileUrl) {
            return await this.loadCloudWorksheetData(cloudFileUrl, sheetName);
        } else if (externalFile) {
            return await this.loadExternalWorksheetData(externalFile, sheetName);
        } else {
            throw new Error("No valid file source specified");
        }
    }

}