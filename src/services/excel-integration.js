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
}