# Using TermNorm

## Use the TermNorm add-in

1. **Select a cell** in your predefined columns within the current worksheet.
2. **Type a term** that you want to standardize.
3. **Press Enter** to trigger the normalization process.
4. The system will automatically perform:
   - Quick lookup for existing mappings
   - Fuzzy matching for similar terms
   - Advanced search with indexing and API requests (requires internet)
5. it will update the target_column automatically.
6. View results in the **Tracking Results** panel. The taskpane should now show under 'Tracking Results>Candidate Ranked' a table with the best candidates. You can select any better one and then click "apply-first" to update the target_column.

When a term is standardized, it will also create an entry in the *log*-file (`C:\Users\<REPLACE_WITH_YOURS>\OfficeAddinApps\TermNorm-excel\backend-api\logs\activity.jsonl`). And when you click "apply-first", it will also log it.

7. Switch between **History** and **Candidate Ranked** views
