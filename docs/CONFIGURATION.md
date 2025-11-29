# Configuration Guide

TermNorm uses a single JSON configuration file that defines column mappings and reference data sources.

---

## Initial Setup

### Configure Authentication and API Keys

**Add users** (for multi-user access):
Edit `backend-api/config/users.json` to add allowed IPs:
```json
{
  "users": {
    "admin": {
      "email": "admin@company.com",
      "allowed_ips": ["127.0.0.1", "192.168.1.100"]
    }
  }
}
```

**Set LLM API key** (required):
```bash
setx GROQ_API_KEY "your_api_key_here"
```

**Configure Web Search (Optional)**:
For reliable web research, configure Brave Search API (2,000 free queries/month):

> **Note:** Brave Search API requires a credit card for registration (even for free tier)

1. Register at: https://api-dashboard.search.brave.com/register
2. Add key to `backend-api\.env`:
   ```
   BRAVE_SEARCH_API_KEY=your_brave_api_key_here
   ```
3. **Restart server** after configuration changes

If not configured, system uses fallback providers: SearXNG → DuckDuckGo → Bing.

**Configure Server URL in Excel** (if using network deployment):
- Open TermNorm → **Settings** tab
- Update "Server URL" to match your backend:
  - Local: `http://127.0.0.1:8000` (default)
  - Network: `http://192.168.1.100:8000` (your server IP)

### Load Mapping Files

- For each Excel reference file, click **Browse**
- Select the corresponding Excel file
- Click **Load Mapping Table**
- Repeat for all reference files

### Activate Tracking

- Navigate to **Load Configuration**
- Click the **Activate Tracking** button

**Monitoring:**
- Monitor real-time processing through the Activity Feed UI component
- Check server status using the status indicator in the task pane

---

## Configuration File Structure

The configuration file (`app.config.json`) has this structure:

```json
{
  "excel-projects": {
    "WorkbookName.xlsx": {
      "column_map": { ... },
      "default_std_suffix": "...",
      "standard_mappings": [ ... ]
    }
  }
}
```

### Key Sections

- **`excel-projects`**: Container for all workbook configurations
- **`WorkbookName.xlsx`**: Excel workbook filename (must match exactly)
- **`column_map`**: Maps input columns to output columns
- **`default_std_suffix`**: Suffix for auto-generated output columns
- **`standard_mappings`**: Array of reference files for terminology lookup

---

## Basic Example

```json
{
  "excel-projects": {
    "MyWorkbook.xlsx": {
      "column_map": {
        "FreeText_Column": "Standardized_Column",
        "Material_Input": "Material_ISO"
      },
      "default_std_suffix": "standardized",
      "standard_mappings": [
        {
          "mapping_reference": "C:\\Reference\\Materials.xlsx",
          "worksheet": "StandardTerms",
          "source_column": "",
          "target_column": "ISO_Standard"
        }
      ]
    }
  }
}
```

**Explanation:**
- Workbook name: `MyWorkbook.xlsx`
- Input column `FreeText_Column` → Output column `Standardized_Column`
- Input column `Material_Input` → Output column `Material_ISO`
- Reference file: `C:\Reference\Materials.xlsx`
- Reference worksheet: `StandardTerms`
- Target column in reference: `ISO_Standard`

---

## Multiple Workbooks

You can configure multiple workbooks in one file:

```json
{
  "excel-projects": {
    "ProjectA.xlsx": {
      "column_map": {
        "Raw_Material": "Material_Standard"
      },
      "default_std_suffix": "std",
      "standard_mappings": [
        {
          "mapping_reference": "C:\\Ref\\Materials_A.xlsx",
          "worksheet": "Terms",
          "source_column": "",
          "target_column": "Standard_Name"
        }
      ]
    },
    "ProjectB.xlsx": {
      "column_map": {
        "Process_Name": "Process_BFO"
      },
      "default_std_suffix": "normalized",
      "standard_mappings": [
        {
          "mapping_reference": "C:\\Ref\\Processes.xlsx",
          "worksheet": "BFO_Terms",
          "source_column": "",
          "target_column": "BFO_ID"
        }
      ]
    }
  }
}
```

---

## Multiple Reference Files

Use multiple reference files for different terminology domains:

```json
{
  "excel-projects": {
    "Research.xlsx": {
      "column_map": {
        "Material": "Material_ISO",
        "Process": "Process_BFO"
      },
      "default_std_suffix": "standardized",
      "standard_mappings": [
        {
          "mapping_reference": "C:\\Reference\\Materials.xlsx",
          "worksheet": "ISO_Standards",
          "source_column": "",
          "target_column": "ISO_Code"
        },
        {
          "mapping_reference": "C:\\Reference\\Processes.xlsx",
          "worksheet": "BFO_Ontology",
          "source_column": "",
          "target_column": "BFO_Term"
        },
        {
          "mapping_reference": "C:\\Reference\\Equipment.xlsx",
          "worksheet": "Equipment_List",
          "source_column": "",
          "target_column": "Equipment_ID"
        }
      ]
    }
  }
}
```

---

## Field Descriptions

### `column_map`

Defines input → output column mappings.

**Format:**
```json
"column_map": {
  "InputColumnName": "OutputColumnName"
}
```

**Rules:**
- Input column must exist in your workbook
- Output column will be created if it doesn't exist
- Column names are case-sensitive
- Use exact column header names from Excel

### `default_std_suffix`

Suffix added to auto-generated output column names.

**Example:**
```json
"default_std_suffix": "standardized"
```

If input column is `Material` and no explicit mapping exists, output column will be `Material_standardized`.

### `standard_mappings`

Array of reference files containing standard terminology.

**Fields:**
- **`mapping_reference`**: Absolute path to Excel reference file
  - Use double backslashes on Windows: `C:\\Path\\File.xlsx`
  - Use forward slashes on Mac/Linux: `/Users/name/file.xlsx`
- **`worksheet`**: Name of worksheet containing terms
- **`source_column`**: Leave empty `""` (not currently used)
- **`target_column`**: Column containing standardized terms

**Example:**
```json
"standard_mappings": [
  {
    "mapping_reference": "C:\\Data\\Reference\\StandardTerms.xlsx",
    "worksheet": "Materials",
    "source_column": "",
    "target_column": "ISO_Standard_Name"
  }
]
```

---

## Loading Configuration

### Microsoft 365 (Cloud Excel)

**Drag & Drop:**
1. Open TermNorm task pane
2. Locate the drag-and-drop area
3. Drag `app.config.json` into the field
4. Configuration loads automatically

### Desktop Excel

**File-based:**
1. Save `app.config.json` to: `<project-root>\config\app.config.json`
2. Open TermNorm task pane
3. Click **Load Config** button
4. Configuration loads from file

---

## Multi-User Setup

Configure which users can access the backend server.

### Edit `backend-api/config/users.json`

```json
{
  "users": {
    "admin": {
      "email": "admin@company.com",
      "allowed_ips": ["127.0.0.1", "192.168.1.100"]
    },
    "researcher1": {
      "email": "researcher1@company.com",
      "allowed_ips": ["192.168.1.101"]
    },
    "researcher2": {
      "email": "researcher2@company.com",
      "allowed_ips": ["192.168.1.102", "192.168.1.103"]
    }
  }
}
```

**Fields:**
- **`email`**: User identifier (for logging)
- **`allowed_ips`**: Array of IP addresses allowed to connect

**Features:**
- Changes are **hot-reloaded** (no server restart needed)
- Multiple IPs per user (for different locations)
- IP-based authentication (no passwords)

---

## Deployment Configuration

**For developers building from source:**

The build process accepts environment variables that control what the UI displays to users. This is important when deploying to IIS servers or Microsoft 365.

### Environment Variables

**`DEPLOYMENT_TYPE`**
- Controls UI behavior and path display
- Values: `development`, `iis`, `m365`
- Default: `development`

**`DEPLOYMENT_PATH`**
- Filesystem path shown to users in the UI
- Used for `development` and `iis` types
- Default: Build directory path
- Example: `C:\inetpub\wwwroot\termnorm`

**`DEPLOYMENT_URL`**
- Base URL for the manifest file
- Default: GitHub Pages URL
- Example: `http://your-server:8080/`

### Build Commands

**For IIS Server deployment:**
```bash
set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm
npm run build:iis
```
- UI shows "IIS Server" deployment type
- Displays server filesystem paths for admins
- Includes drag-and-drop instructions for regular users

**For Microsoft 365 deployment:**
```bash
npm run build:m365
```
- UI shows "Microsoft 365" deployment type
- Hides all filesystem paths
- Shows drag-and-drop instructions only

**For standard build:**
```bash
npm run build
```
- UI shows "Development" deployment type
- Displays build directory paths

### When to Use Each

| Deployment Type | Use When | UI Behavior |
|----------------|----------|-------------|
| `development` | Building for local development or GitHub Pages | Shows development paths |
| `iis` | Deploying to Windows Server/IIS | Shows server paths for admin access |
| `m365` | Publishing to Microsoft 365 App Catalog | Hides paths, drag-and-drop only |

**Example: Full IIS deployment build**
```bash
set DEPLOYMENT_URL=http://myserver:8080/termnorm/
set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm
npm run build:iis
```

See [Installation Guide](INSTALLATION.md) and [Developer Guide](DEVELOPER.md) for complete deployment instructions.

---

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
4. Check Activity Feed for processing status

### Multi-User Auth Issues

**Problem:** "IP not authorized" error

**Solutions:**
1. Check your IP address: https://whatismyipaddress.com
2. Add IP to `backend-api/config/users.json`
3. Wait ~5 seconds for hot-reload
4. Verify no typos in IP address

---

## Example Configurations

### Materials Research

```json
{
  "excel-projects": {
    "Materials_Database.xlsx": {
      "column_map": {
        "Material_FreeText": "Material_ISO",
        "Process": "Process_Standard"
      },
      "default_std_suffix": "std",
      "standard_mappings": [
        {
          "mapping_reference": "C:\\Reference\\ISO_Materials.xlsx",
          "worksheet": "Materials",
          "source_column": "",
          "target_column": "ISO_Code"
        },
        {
          "mapping_reference": "C:\\Reference\\Manufacturing_Processes.xlsx",
          "worksheet": "Processes",
          "source_column": "",
          "target_column": "Standard_Process_Name"
        }
      ]
    }
  }
}
```

### Ontology Mapping

```json
{
  "excel-projects": {
    "Ontology_Terms.xlsx": {
      "column_map": {
        "Raw_Term": "BFO_Term",
        "Equipment": "Equipment_URI"
      },
      "default_std_suffix": "mapped",
      "standard_mappings": [
        {
          "mapping_reference": "C:\\Ontology\\BFO_Terms.xlsx",
          "worksheet": "Basic_Formal_Ontology",
          "source_column": "",
          "target_column": "BFO_URI"
        },
        {
          "mapping_reference": "C:\\Ontology\\Equipment.xlsx",
          "worksheet": "Equipment_Ontology",
          "source_column": "",
          "target_column": "URI"
        }
      ]
    }
  }
}
```

### Multi-Project Setup

```json
{
  "excel-projects": {
    "Project_Alpha.xlsx": {
      "column_map": {
        "Input": "Output"
      },
      "default_std_suffix": "std",
      "standard_mappings": [
        {
          "mapping_reference": "C:\\Ref\\Alpha_Terms.xlsx",
          "worksheet": "Terms",
          "source_column": "",
          "target_column": "Standard"
        }
      ]
    },
    "Project_Beta.xlsx": {
      "column_map": {
        "Raw_Data": "Normalized_Data"
      },
      "default_std_suffix": "normalized",
      "standard_mappings": [
        {
          "mapping_reference": "C:\\Ref\\Beta_Standards.xlsx",
          "worksheet": "Standards",
          "source_column": "",
          "target_column": "Norm_Value"
        }
      ]
    }
  }
}
```

---

## Related Documentation

- **[Installation Guide](INSTALLATION.md)** - Setup instructions
- **[Usage Guide](USAGE.md)** - How to use the add-in
- **[Developer Guide](DEVELOPER.md)** - For modifying the code
- **[Troubleshooting](TROUBLESHOOTING.md)** - Common issues
