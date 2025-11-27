# Installation Guide

## 1. 📦 Installation (End Users)

### 1.1 Step 1: Download the Release Package

**Download the pre-built application files:**

1. Visit the releases page: **https://github.com/runfish5/TermNorm-excel/releases**
2. Download **`dist.zip`** from the latest release (v1.0.1 or later)
3. Extract the zip file to your desired location:
   - **For local use**: Extract anywhere (e.g., `C:\TermNorm-excel\`)
   - **For IIS deployment**: You'll move files to `C:\inetpub\wwwroot\termnorm\` in Step 3

### 1.2 Step 2: Prerequisites

- **Microsoft Excel** installed on your system or licence for the cloud version (Microsoft 365 subscription)
- **Python** (version 3.9+) for the backend server - [Download here](https://www.python.org/downloads/)
  - To verify: `python --version` in your terminal

### 1.3 Step 3: Choose Your Deployment Method

**Option A: Microsoft 365 (Cloud Excel)** → Skip to [365 Cloud Setup](#365-cloud-setup)

**Option B: Desktop Excel (Windows Server/IIS)** → Continue with [Windows Server Deployment](#windows-server-deployment) below

**Option C: Desktop Excel (Local Development)** → Skip to [Desktop Excel Setup](#desktop-excel-setup-sideloading)

---

## 2. Windows Server Deployment

**For IT administrators deploying to Windows Server for internal/enterprise use**

This section describes the **standard Microsoft-recommended approach** for deploying Office add-ins on internal networks using IIS and network share catalogs.

### 2.1 Overview

The deployment uses:
- **IIS (Internet Information Services)** - Built into Windows Server for hosting static files
- **Network Shared Folder Catalog** - Microsoft's recommended method for enterprise sideloading
- **HTTP hosting** - Acceptable for internal networks (HTTPS optional)

This is the industry-standard approach documented in [Microsoft's official Office Add-ins deployment guide](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins).

### 2.2 Prerequisites for Windows Server Deployment

1. **Windows Server** with IIS enabled
   - Open Server Manager → Add Roles and Features
   - Select **Web Server (IIS)** role
   - Include **Management Tools** and **Static Content** features

2. **Network share configured** for manifest distribution
   - Create folder (e.g., `C:\OfficeAddIns`)
   - Share with users (Read permissions)
   - Note the UNC path (e.g., `\\SERVERNAME\OfficeAddIns`)

3. **Downloaded release package** from Step 1 above
   - Extract `dist.zip` to a temporary location

### 2.3 Deployment Steps

**Step 1: Extract the Release Package**

Extract the downloaded `dist.zip` to a temporary location (e.g., `C:\Temp\TermNorm-dist\`)

**Step 2: Deploy to IIS** *(Requires Administrator)*

**Option A: Automated deployment (Recommended)**

If you have the full repository with deployment scripts:
```bash
scripts\deployment\setup-iis.bat
```

This script automatically:
1. Creates folder: `C:\inetpub\wwwroot\termnorm\`
2. Copies all files from `dist/` to the IIS folder
3. Creates IIS website named "TermNorm" on port 8080
4. Configures HTTP binding
5. Tests the deployment

**Option B: Manual deployment (Using dist.zip only)**

1. Open PowerShell as Administrator (Right-click Start → PowerShell → Run as Administrator)

2. Copy and paste these commands:

```powershell
$src = "C:\Temp\TermNorm-dist"  # Or your actual extraction path
$dest = "C:\inetpub\wwwroot\termnorm"

# Remove old files and copy new ones
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
Copy-Item $src -Destination $dest -Recurse -Force

# Configure IIS
Import-Module WebAdministration
if (Test-Path "IIS:\Sites\TermNorm") {
    Restart-WebAppPool "TermNorm" -ErrorAction SilentlyContinue
    Restart-WebItem "IIS:\Sites\TermNorm"
} else {
    New-Website -Name "TermNorm" -PhysicalPath $dest -Port 8080 -Force
}

# Test
Start-Process "http://localhost:8080/taskpane.html"
```

3. Replace `C:\Temp\TermNorm-dist` with your actual extraction path

4. Verify deployment:
   - Files should be in `C:\inetpub\wwwroot\termnorm\`
   - Browser should open to `http://localhost:8080/taskpane.html`
   - Check file dates match today's date

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

### 2.4 Configuration Updates

The `config/app.config.json` file is bundled into the JavaScript during build. For configuration changes:

**For End Users:**
- Download the latest release with your updated configuration
- Redeploy following Step 2 above
- Users restart Excel to load updated configuration

**For Developers:**
- See [Developer Setup](#for-developers) section below for rebuild instructions
- **Important:** Use `npm run build:iis` with `DEPLOYMENT_PATH` set to ensure the UI shows correct server paths to users:
  ```bash
  set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm
  npm run build:iis
  ```
  This makes the add-in display "IIS Server" deployment type and show the correct filesystem paths for configuration files.

### 2.5 Troubleshooting

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

**Excel loads old version after deployment update**

If Excel shows an old build (check build date in "About & Version Info") even after redeploying:

1. **Close all Excel windows/processes** (verify in Task Manager - no EXCEL.EXE running)

2. **Clear Office add-in cache**:
   ```cmd
   rd /s /q "%LOCALAPPDATA%\Microsoft\Office\16.0\Wef"
   rd /s /q "%LOCALAPPDATA%\Microsoft\Office\16.0\WEF"
   ```

3. **Clear browser cache** (Office uses Edge WebView):
   ```cmd
   rd /s /q "%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Cache"
   ```

4. **Remove and re-add the add-in**:
   - Open Excel
   - Insert → My Add-ins → Three dots menu → Remove TermNorm
   - Close Excel completely
   - Reopen Excel
   - Insert → My Add-ins → SHARED FOLDER → Add TermNorm

5. **Verify correct version loaded**:
   - Open TermNorm task pane
   - Check "About & Version Info" → Build date should match deployment date
   - Verify expected configuration changes appear

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

## 3. Add the add-in to Excel

### 3.1 365 Cloud setup

1. **Download the manifest file:**
   - Extract `dist.zip` (from Step 1 above)
   - Locate `manifest-cloud.xml` inside the extracted folder

2. **Upload to Excel:**
   - In Excel 'Home' tab, click on 'Add-ins' → 'My Add-ins' → 'Upload my Add-in'
   - Browse and select the `manifest-cloud.xml` file
   - Click **Open**

3. **Verify installation:**
   - The TermNorm task pane should appear on the right side
   - If not visible, check that you're using Excel for the Web (not Desktop)

### 3.2 Desktop Excel setup (Sideloading)

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

**Step 3: Get Manifest File**
1. Extract `dist.zip` (from Installation Step 1 above)
2. Locate `manifest.xml` inside the extracted folder

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


## 4. Run the add-in

### 4.1 Define your project configurations

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

     > **Note:** Brave Search API requires a credit card for registration (even for free tier)

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

### 4.2 Start tracking

7. **Activate tracking.**
   - Navigate to **Load Configuration**
   - Click the **Activate Tracking** button

8. **Trouble shoting.**
- Monitor real-time processing through the Activity Feed UI component
- Check server status using the status indicator in the task pane
- Wait for user instruction before running any validation or testing commands

---

## 5. For Developers

**If you need to modify the source code or build from scratch:**

See the **[Developer Guide](DEVELOPER.md)** for complete development setup including:
- Prerequisites and environment setup
- Cloning the repository
- Frontend and backend development workflows
- Build commands for different deployment scenarios
- Debugging and testing
- Architecture overview

---

## 6. Version Control and Security

### 6.1 📦 Official Releases Only

**IMPORTANT:** Download files exclusively from official releases:
- **Release page:** https://github.com/runfish5/TermNorm-excel/releases
- You will receive email notifications for each new version (e.g., v1.0.0)
- Only update when you receive an email notification

### 6.2 ⚠️ Development Branches

**Do NOT use the master branch or other branches:**
- These are for development and untested
- Release branches (release/v1.x.x) are immutable and stable
- This protects against unnoticed code changes and ensures traceability

### 6.3 🆘 Support

- Always provide your version number for support requests
- Version number location: `<Version>` tag in manifest.xml
- Contact: uniqued4ve@gmail.com
