// services/excel-integration.js
import * as XLSX from 'xlsx';

export class ExcelIntegration {
    constructor() {
        this.cachedWorkbook = null;
        this.cachedFileName = null;
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

    
    async loadWorksheetData({ useCurrentFile, sheetName, externalFile }) {
        if (!sheetName?.trim()) throw new Error("Sheet name is required");
        
        return useCurrentFile ? 
            await this.loadCurrentWorksheetData(sheetName) : 
            await this.loadExternalWorksheetData(externalFile, sheetName);
    }

}