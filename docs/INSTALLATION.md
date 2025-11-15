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

---

## Windows Server Deployment

**For IT administrators deploying to Windows Server for internal/enterprise use**

This section describes the **standard Microsoft-recommended approach** for deploying Office add-ins on internal networks using IIS and network share catalogs.

### Overview

The deployment uses:
- **IIS (Internet Information Services)** - Built into Windows Server for hosting static files
- **Network Shared Folder Catalog** - Microsoft's recommended method for enterprise sideloading
- **HTTP hosting** - Acceptable for internal networks (HTTPS optional)

This is the industry-standard approach documented in [Microsoft's official Office Add-ins deployment guide](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins).

### Prerequisites for Windows Server Deployment

1. **Windows Server** with IIS enabled
   - Open Server Manager → Add Roles and Features
   - Select **Web Server (IIS)** role
   - Include **Management Tools** and **Static Content** features

2. **Network share configured** for manifest distribution
   - Create folder (e.g., `C:\OfficeAddIns`)
   - Share with users (Read permissions)
   - Note the UNC path (e.g., `\\SERVERNAME\OfficeAddIns`)

3. **Node.js installed** (for building the add-in)
   - Only needed on build machine, not on server

### Deployment Steps

**Step 1: Build for HTTP Deployment**

**Important:** Navigate to the project directory first:
```bash
cd C:\path\to\TermNorm-excel
```

Then run:
```bash
scripts\deployment\build-http.bat
```

This rebuilds the `dist/` folder with URLs pointing to `http://localhost:8080/`.

**To use server name instead of localhost:**
```bash
cd C:\path\to\TermNorm-excel
set DEPLOYMENT_URL=http://SERVERNAME:8080/
npm run build
```

Replace `C:\path\to\TermNorm-excel` with your actual project path and `SERVERNAME` with your server's hostname.

**Step 2: Deploy to IIS** *(Requires Administrator)*

Run as Administrator:
```bash
scripts\deployment\setup-iis.bat
```

This script automatically:
1. Creates folder: `C:\inetpub\wwwroot\termnorm\`
2. Copies all files from `dist/` to the IIS folder
3. Creates IIS website named "TermNorm" on port 8080
4. Configures HTTP binding
5. Tests the deployment

<details>
<summary><b>Alternative: Manual IIS Configuration</b> (click to expand)</summary>

If you prefer manual setup:

1. Copy `dist\*` to `C:\inetpub\wwwroot\termnorm\`

2. Open IIS Manager (run `inetmgr`)

3. Right-click **Sites** → **Add Website**:
   - **Site name**: TermNorm
   - **Physical path**: `C:\inetpub\wwwroot\termnorm`
   - **Binding**: HTTP, port 8080
   - Click **OK**

4. Test: Open browser to `http://localhost:8080/taskpane.html`
   - Should display the TermNorm interface

</details>

**Step 3: Distribute Manifest**

Copy the manifest to your network share:
```bash
copy C:\inetpub\wwwroot\termnorm\manifest.xml \\SERVERNAME\OfficeAddIns\
```

**Step 4: User Configuration** *(One-time per user)*

Users must configure Excel to trust your catalog:

1. Excel → **File** → **Options** → **Trust Center** → **Trust Center Settings**
2. Click **Trusted Add-in Catalogs**
3. In **Catalog Url**, enter: `\\SERVERNAME\OfficeAddIns`
4. Click **Add catalog**
5. Check **Show in Menu**
6. Click **OK** and restart Excel

**Step 5: Sideload the Add-in** *(Per user)*

1. Excel → **Insert** → **Get Add-ins**
2. Select **SHARED FOLDER** (top of dialog)
3. Select **TermNorm**
4. Click **Add**

The add-in loads from `http://SERVERNAME:8080/` (or localhost if configured that way).

### Configuration Updates

When you update `config/app.config.json`:

1. **Rebuild**: Run `scripts\deployment\build-http.bat`
2. **Redeploy**: Run `scripts\deployment\setup-iis.bat` (as Administrator)
3. **Refresh**: Users restart Excel to load updated configuration

The configuration file is bundled into the JavaScript during build, so rebuild + redeploy is required for config changes to take effect.

### Troubleshooting

**401.3 Unauthorized Error**

If browser shows "401.3 Unauthorized" when testing `http://localhost:8080/taskpane.html`:

- The files are in a user folder that IIS cannot access
- Solution: `scripts\deployment\setup-iis.bat` automatically moves files to `C:\inetpub\wwwroot\termnorm\` where IIS has full access

**Add-in doesn't appear in SHARED FOLDER**

- Verify manifest copied to `\\SERVERNAME\OfficeAddIns\`
- Check users configured Trusted Catalog correctly
- Ensure network path is accessible to users
- Restart Excel after adding catalog

**Network connectivity error when loading add-in**

- Test the URL in browser: `http://SERVERNAME:8080/taskpane.html`
- Check IIS website is running (IIS Manager → Sites → TermNorm → State: Started)
- Verify firewall allows port 8080
- Ensure manifest URLs match server configuration

**For HTTPS (recommended for production)**

To use HTTPS instead of HTTP:

1. Obtain SSL certificate for your server
2. Bind certificate to IIS website (Port 443)
3. Rebuild with HTTPS URL:
   ```bash
   set DEPLOYMENT_URL=https://SERVERNAME/termnorm/
   npm run build
   ```
4. Redeploy to IIS

---

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


4. **Start the Python server (RECOMMENDED).**

   Simply double-click the `start-server-py-LLMs.bat` file in the TermNorm-excel directory.

   <details>
   <summary>What does the script do?</summary>

   The script automatically:
   - ✅ Sets up virtual environment
   - ✅ Installs all dependencies
   - ✅ Chooses deployment type (Local or Network)
   - ✅ Runs diagnostics and starts server
   </details>

   <details>
   <summary>Manual setup (for advanced users or troubleshooting)</summary>

   - Navigate to the backend directory:
     ```bash
     cd C:\Users\<REPLACE_WITH_YOURS>\OfficeAddinApps\TermNorm-excel\backend-api
     ```
   - Create and activate virtual environment:
     ```bash
     python -m venv .venv
     .\.venv\Scripts\activate
     pip install -r requirements.txt
     ```
   - Start server:
     - Local: `python -m uvicorn main:app --reload`
     - Network: `python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload`
   </details>

5. **Configure authentication and API keys (one-time setup).**

   - **Add users** (for multi-user access):
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

   - **Set LLM API key** (required):
     ```bash
     setx GROQ_API_KEY "your_api_key_here"
     ```

   - **Configure Web Search (Optional)**:
     For reliable web research, configure Brave Search API (2,000 free queries/month):
     1. Register at: https://api-dashboard.search.brave.com/register
     2. Add key to `backend-api\.env`:
        ```
        BRAVE_SEARCH_API_KEY=your_brave_api_key_here
        ```
     3. **Restart server** after configuration changes

     If not configured, system uses fallback providers: SearXNG → DuckDuckGo → Bing.

   - **Configure Server URL in Excel** (if using network deployment):
     - Open TermNorm → **Settings** tab
     - Update "Server URL" to match your backend:
       - Local: `http://127.0.0.1:8000` (default)
       - Network: `http://192.168.1.100:8000` (your server IP)

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
