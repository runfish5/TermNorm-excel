# Configuration Guide

TermNorm uses a single JSON configuration file that defines column mappings and reference data sources.

---

## Initial Setup

### 1. Set LLM API Key (Required)
```bash
setx GROQ_API_KEY "your_api_key_here"
```

### 2. Configure Users (Multi-user access)

Edit `backend-api/config/users.json`:

```jsonc
{
  "users": {
    "admin": {
      "email": "admin@company.com",              // User identifier for logs
      "allowed_ips": ["127.0.0.1", "10.0.0.100"] // IPs allowed to connect
    },
    "researcher1": {
      "email": "researcher1@company.com",
      "allowed_ips": ["10.0.0.101"]
    }
  }
}
```

**Features:** Changes hot-reload (no restart needed), multiple IPs per user, IP-based auth

### 3. Configure Web Search (Optional)

For reliable web research, configure Brave Search API (2,000 free queries/month):

> **Note:** Brave Search API requires a credit card for registration (even for free tier)

1. Register at: https://api-dashboard.search.brave.com/register
2. Add key to `backend-api\.env`:
   ```
   BRAVE_SEARCH_API_KEY=your_brave_api_key_here
   ```
3. **Restart server** after configuration changes

If not configured, system uses fallback providers: SearXNG → DuckDuckGo → Bing.

### 4. Configure Server URL (Network deployment)

- Open TermNorm → **Settings** tab
- Update "Server URL" to match your backend:
  - Local: `http://127.0.0.1:8000` (default)
  - Network: `http://10.0.0.100:8000` (your server IP)

---

## Workbook Configuration (`app.config.json`)
```jsonc
{
  "excel-projects": {
    "MyWorkbook.xlsx": {
      "column_map": {                                             // Maps input columns to output + confidence
        "ProductName": {                                                // Input column name
          "output": "StandardProductName",                              // Where normalized result goes
          "confidence": "ProductName_confidence"                        // Optional: confidence score column
        },
        "Material": { "output": "Material_std" }                        // confidence is optional
      },
      "standard_mappings": [                                      // Reference files with approved terms
        {
          "mapping_reference": "C:\\MyDocuments\\ReferenceData.xlsx",   // Reference file path
          "worksheet": "StandardNames",                                 // Tab in that file
          "source_column": "",                                          // Leave empty
          "target_column": "ApprovedNames"                              // Column with approved terms
        }
      ]
    }
  }
}
```

---

## What Each Part Means

### `column_map`

This tells the system which columns to work on, where to put results, and optionally where to write confidence scores.

**How to write it:**
```json
"column_map": {
  "YourInputColumn": {
    "output": "WhereResultsGoColumn",
    "confidence": "WhereConfidenceGoesColumn"
  }
}
```

**Important:**
- `YourInputColumn` must already exist in your Excel file
- `output` column will be created automatically if it doesn't exist
- `confidence` is optional - omit it if you don't want confidence scores
- Names must match EXACTLY as they appear in Excel (including capitals and spaces)

### `standard_mappings`

This tells the system where to find your list of approved/standard terms.

```jsonc
"standard_mappings": [
  {
    "mapping_reference": "C:\\MyFolder\\ApprovedTerms.xlsx",  // Full path to reference file
    "worksheet": "Products",                                   // Tab with approved names
    "source_column": "",                                       // Leave empty
    "target_column": "OfficialProductNames"                    // Column with approved names
  }
]
```



## Configuration Tips

### File Paths

**Windows:**
- Use double backslashes: `"C:\\Users\\Name\\File.xlsx"`
- Or use forward slashes: `"C:/Users/Name/File.xlsx"`

**Mac/Linux:**
- Use forward slashes: `"/Users/name/Documents/file.xlsx"`

### Workbook Names

**Must match exactly:**
- Filename: `Research_2024.xlsx`
- Config: `"Research_2024.xlsx"` ✅
- Config: `"research_2024.xlsx"` ❌ (wrong case)
- Config: `"Research_2024"` ❌ (missing extension)

### Column Names

**Case-sensitive and exact:**
- Excel column: `Material Name`
- Config: `"Material Name"` ✅
- Config: `"Material name"` ❌ (wrong case)
- Config: `"MaterialName"` ❌ (missing space)

### Reference Files

**Best practices:**
- Use absolute paths (not relative)
- Keep reference files in a central location
- Don't move files after configuration
- Verify worksheet names match exactly

---

## Troubleshooting

### Configuration Not Loading

**Problem:** "Configuration not found" error

**Solutions:**
1. Validate JSON syntax: https://jsonlint.com
2. Check workbook name matches Excel filename exactly
3. For Desktop Excel: Verify file is in `config/app.config.json`
4. Check for trailing commas (invalid JSON)

### Reference Files Not Found

**Problem:** "File not found" when loading mappings

**Solutions:**
1. Use absolute paths (not relative)
2. Use double backslashes on Windows: `C:\\Path\\File.xlsx`
3. Verify files exist at specified paths
4. Check file permissions (readable by your user)

### Columns Not Mapping

**Problem:** Output column not being populated

**Solutions:**
1. Verify input column name matches exactly (case-sensitive)
2. Check output column exists or can be created
3. Activate tracking after loading configuration
4. Check Matching Journal for processing status

### Multi-User Auth Issues

**Problem:** "IP not authorized" error

**Solutions:**
1. Check your IP address: https://whatismyipaddress.com
2. Add IP to `backend-api/config/users.json`
3. Wait ~5 seconds for hot-reload
4. Verify no typos in IP address

---

## Example Configurations

### Materials Research Example

```jsonc
{
  "excel-projects": {
    "Materials_Database.xlsx": {
      "column_map": {
        "Material_FreeText": { "output": "Material_ISO", "confidence": "Material_confidence" },
        "Process": { "output": "Process_Standard" }
      },
      "standard_mappings": [
        { "mapping_reference": "C:\\Reference\\ISO_Materials.xlsx", "worksheet": "Materials", "source_column": "", "target_column": "ISO_Code" },
        { "mapping_reference": "C:\\Reference\\Manufacturing_Processes.xlsx", "worksheet": "Processes", "source_column": "", "target_column": "Standard_Process_Name" }
      ]
    }
  }
}
```

### Multi-Project Setup Example

```jsonc
{
  "excel-projects": {
    "Project_Alpha.xlsx": {
      "column_map": {
        "Input": { "output": "Output", "confidence": "Input_confidence" }
      },
      "standard_mappings": [
        { "mapping_reference": "C:\\Ref\\Alpha_Terms.xlsx", "worksheet": "Terms", "source_column": "", "target_column": "Standard" }
      ]
    },
    "Project_Beta.xlsx": {
      "column_map": {
        "Raw_Data": { "output": "Normalized_Data" }
      },
      "standard_mappings": [
        { "mapping_reference": "C:\\Ref\\Beta_Standards.xlsx", "worksheet": "Standards", "source_column": "", "target_column": "Norm_Value" }
      ]
    }
  }
}
```

---

## Related Documentation

- **[Installation Guide](INSTALLATION.md)** - Setup instructions
- **[Setup Guide](SETUP-GUIDE.md)** - How to use the add-in
- **[Developer Guide](DEVELOPER.md)** - For modifying the code
- **[Troubleshooting](TROUBLESHOOTING.md)** - Common issues
