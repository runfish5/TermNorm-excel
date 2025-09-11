// Column mapping service - handles Excel column resolution with caching and validation
import { buildColumnMap } from "../utils/column-utilities.js";

class ColumnMappingService {
  constructor() {
    this.cache = new Map(); // Cache by workbook name
  }

  async resolveColumnMapping(config) {
    const workbook = config.workbook;
    const cacheKey = `${workbook}_${JSON.stringify(config.column_map)}`;
    
    if (this.cache.has(cacheKey)) {
      console.log("Using cached column mapping for", workbook);
      return this.cache.get(cacheKey);
    }

    const mapping = await this._buildColumnMapping(config.column_map);
    this.cache.set(cacheKey, mapping);
    
    console.log("Column mapping resolved and cached:", Array.from(mapping.entries()));
    return mapping;
  }

  async _buildColumnMapping(columnMap) {
    return await Excel.run(async (ctx) => {
      const ws = ctx.workbook.worksheets.getActiveWorksheet();
      
      // Get the used range to determine the extent
      const usedRange = ws.getUsedRange(true);
      usedRange.load("columnIndex, columnCount");
      await ctx.sync();
      
      // Get full header row from column A to last used column
      const lastColumnIndex = usedRange.columnIndex + usedRange.columnCount - 1;
      const headerRange = ws.getRangeByIndexes(0, 0, 1, lastColumnIndex + 1);
      headerRange.load("values");
      await ctx.sync();

      const headerNames = headerRange.values[0].map((h) => String(h || "").trim());
      
      console.log("Excel headers found (full row from A):", headerNames);
      console.log("Column map config:", columnMap);
      
      return buildColumnMap(headerNames, columnMap);
    });
  }

  validateMapping(mapping) {
    if (!mapping || mapping.size === 0) {
      throw new Error("Column mapping is empty or invalid");
    }

    // Validate that all mappings are valid indexes
    for (const [src, tgt] of mapping.entries()) {
      if (typeof src !== 'number' || typeof tgt !== 'number' || src < 0 || tgt < 0) {
        throw new Error(`Invalid column mapping: ${src} → ${tgt}`);
      }
    }

    return true;
  }

  clearCache(workbook = null) {
    if (workbook) {
      // Clear cache for specific workbook
      for (const key of this.cache.keys()) {
        if (key.startsWith(workbook + '_')) {
          this.cache.delete(key);
        }
      }
    } else {
      // Clear all cache
      this.cache.clear();
    }
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

// Export singleton instance
export const columnMappingService = new ColumnMappingService();