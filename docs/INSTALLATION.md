# Installation Guide

## Version Control and Security

IMPORTANT - Use only official releases:

You will receive an email notification with a specific release link (e.g. v1.0.0) for each new version. Download files exclusively from the provided release: https://github.com/runfish5/TermNorm-excel/releases

Do NOT use the master branch or other branches - these are for development and untested. Release branches (release/v1.x.x) are immutable and stable. This protects against unnoticed code changes and ensures traceability.

Only update when you receive an email notification. Always provide your version number for support requests (see <Version> in manifest.xml).

---

## Prerequisites

- Microsoft Excel installed on your system or licence for the cloud version (Microsoft 365 subscription).
- Python (latest version). Visit the Python.org site to download and install the right version for your operating system. To verify if you've already installed Python, run the command `python -v` in your terminal.

## Add the add-in to Excel

### 365 Cloud setup
1. Download the 'manifest-cloud.xml' from https://github.com/runfish5/TermNorm-excel/blob/master/manifest-cloud.xml

2. In the Excel 'Home' tab, click on 'Add-ins', then 'My Add-ins', then 'Upload my Add-in'

3. In the popup, click on browse to pick the 'manifest-cloud.xml'

4. Now the taskpane that is displayed in the image at the top should be visible. If not, you did something wrong, try solve it otherwise contact me.

### Desktop Excel setup (Sideloading)

> **⚠️ IMPORTANT NOTE - Sideloading for Excel Desktop Only**
>
> The "Upload my Add-in" option **only works in Excel for the Web**, not in the Desktop version. For Desktop Excel, you must use the **sideloading method** via network share.

#### Method 1: Sideloading via Network Share (recommended for Desktop)

**Step 1: Create Network Share (one-time setup)**
1. Create a folder on your computer (e.g., `C:\OfficeAddIns`)
2. Right-click on the folder → **Properties** → **Sharing tab** → **Share**
3. Add yourself and click **Share**
4. Note the full network path (e.g., `\\COMPUTERNAME\OfficeAddIns`)

**Step 2: Configure Trusted Catalog (one-time setup)**
1. Open Excel
2. **File** → **Options** → **Trust Center** → **Trust Center Settings**
3. Select **Trusted Add-in Catalogs**
4. Enter the full network path (e.g., `\\COMPUTERNAME\OfficeAddIns`)
5. Click **Add catalog**
6. Check **Show in Menu**
7. Click **OK** and restart Excel

**Step 3: Download Manifest File**
1. Download the `manifest.xml` from GitHub:
   - **Direct link**: https://github.com/runfish5/TermNorm-excel/blob/master/manifest.xml
   - Click **Raw** → Right-click → **Save as**
   - Or clone the entire repository (see Prerequisites)

**Step 4: Install Add-in**
1. Copy the downloaded `manifest.xml` to your shared folder (e.g., `C:\OfficeAddIns\`)
2. Open Excel
3. **Home** → **Add-ins** → **More Add-ins**
4. Select **SHARED FOLDER** at the top of the dialog
5. Select the add-in and click **Add**

#### Method 2: Alternative for Mac (macOS only)
On Mac, you can copy the `manifest.xml` directly to:
```
/Users/<username>/Library/Containers/com.Microsoft.Excel/Data/Documents/Wef
```


## Run the add-in

### Define your project configurations

1. **Open your Excel workbook** where you want to use TermNorm.

2. **Create your configuration file.**
  - Create an `app.config.json` file as shown below
      - To customize for your project, define your `"coumn_map"` and `"standard_mappings"`. You can add more than one.
      - Every project configuraiton is stored inside the brackets here: `{"excel-projects": {<HERE>}}` and has the following structure:
  - Include file paths, worksheet names, source and target columns for each mapping reference
  - Example:
  ```json

  {
    "excel-projects": {
      "Book 32.xlsx": {
        "column_map": {
          "name_of_your_input_column": "name_of_mapped_output_column",
          "b": "b_std"
        },
        "default_std_suffix": "standardized",
        "standard_mappings": [
          {
            "mapping_reference": "C:\\Users\\jon\\ReferenceTerms.xlsx",
            "worksheet": "Materials",
            "source_column": "",
            "target_column": "ISO"
          },
          {
            "mapping_reference": "C:\\Users\\jon\\MoreTerms.xlsx",
            "worksheet": "Processing",
            "source_column": "",
            "target_column": "BFO"
          }
        ]
      }
    }
  }
  ```

3. **Load your configuration.**
   For 365 Cloud environment:
   - In the TermNorm interface, locate the drag-and-drop field
   - Drop your `app.config.json` file into the field
   - The configuration will appear in the user interface

   For local Excel
   - Save your `app.config.json` at `C:\Users\<REPLACE_WITH_YOURS>\OfficeAddinApps\TermNorm-excel\config\app.config.json`
   - Use the **Load Config** button to reload existing configuration


4. **Set up the Python server.**
   - Open the terminal using `windows-key` and type 'cmd' in the search, click on 'command prompt'.
   - Navigate to the `\OfficeAddinApps\TermNorm-excel\backend-api` directory
      ```bash
      cd C:\Users\<REPLACE_WITH_YOURS>\OfficeAddinApps\TermNorm-excel\backend-api
      ```
   - Create and activate a virtual environment:
     ```bash
     .\venv\Scripts\activate
     ```

   - **Configure users** (for multi-user access):
     Edit `backend-api/config/users.json` to add allowed IPs:
     ```json
     {
       "users": {
         "admin": {
           "email": "admin@company.com",
           "allowed_ips": ["127.0.0.1"]
         }
       }
     }
     ```

   - **Configure LLM provider**:
     Set Groq or OpenAI API keys in your environment for research-and-match functionality

   - **Configure Web Search (Optional)**:
     For reliable web research, configure Brave Search API (2,000 free queries/month):
     1. Register at: https://api-dashboard.search.brave.com/register
     2. Create an API key
     3. Add to `backend-api\.env` file:
        ```
        BRAVE_SEARCH_API_KEY=your_brave_api_key_here
        ```

     **IMPORTANT:** After adding or changing the Brave API key in `.env`, you must **restart the Python server** for changes to take effect.

     If not configured, the system uses fallback providers: SearXNG → DuckDuckGo → Bing.

   - **Start the Python server**
      - Local Development (default: `http://127.0.0.1:8000`)
      ```bash
      python -m uvicorn main:app --reload
      ```

      - Network based (team/production):
      ```bash
      python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
      ```

   - **Configure Server URL in Excel** (if needed):
      - Open TermNorm → **Settings** tab
      - Update "Server URL" field to match your backend location:
        - Local: `http://127.0.0.1:8000` (default)
        - Network: `http://192.168.1.100:8000` (example)
        - Production: `https://api.yourcompany.com`
      - No save button needed - updates instantly

6. **Load mapping files.**
   - For each Excel reference file, click **Browse**
   - Select the corresponding Excel file
   - Click **Load Mapping Table**
   - Repeat for all reference files

---
Note: Setup complete

### Start tracking

7. **Activate tracking.**
   - Navigate to **Load Configuration**
   - Click the **Activate Tracking** button

8. **Trouble shoting.**
- Monitor real-time processing through the Activity Feed UI component
- Check server status using the status indicator in the task pane
- Wait for user instruction before running any validation or testing commands
