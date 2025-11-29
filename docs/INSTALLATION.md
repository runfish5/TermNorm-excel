# Installation Guide

## Updating

> **Note:** Only for updating an existing IIS deployment of TermNorm.
> For first-time installation, skip to [Section 1: Installation](#1--installation).

1. Backup these two files: `config/app.config.json` &  `backend-api/logs/activity.jsonl`

2. Delete the existing TermNorm root directory to ensure a clean installation.

3. Download `termnorm-deploy-v1.xx.xx.zip` from https://github.com/runfish5/TermNorm-excel/releases
and extract to your desired location (e.g., `C:\Users\Public\TermNorm-excel\`)

4. Open PowerShell as Administrator and run the following script:
      <details><summary>  Script to deploy to IIS.</summary>
  
   **IMPORTANT:** Correct the `$src` variable to match your extraction location. Leave all other lines unchanged.

   ```powershell
   # IMPORTANT: Adjust the $src path to match your extraction location
   $src = "C:\Users\Public\TermNorm-excel\dist"
   $dest = "C:\inetpub\wwwroot\termnorm"

   # Remove old files and copy new ones
   if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
   Copy-Item $src -Destination $dest -Recurse -Force

   # Configure IIS
   Import-Module WebAdministration
   if (Test-Path "IIS:\Sites\TermNorm") {
       # Just restart the site, not the app pool
       Restart-WebItem "IIS:\Sites\TermNorm"
   } else {
       New-Website -Name "TermNorm" -PhysicalPath $dest -Port 8080 -Force
   }

   # Test
   Start-Process "http://localhost:8080/taskpane.html"
   ```
   </details>

5. Copy Manifest to Network Share `copy C:\inetpub\wwwroot\termnorm\manifest-iis.xml C:\OfficeAddIns\`

6. Restore your backed-up `activity.jsonl` and `app.config.json` to the new backend location
7. Close all Excel windows completely and reopen Excel


---

## 1. 📦 Installation

### Step 1: Download the Release Package

**Download the pre-built application files:**

1. Visit the releases page: **https://github.com/runfish5/TermNorm-excel/releases**
2. Download **`termnorm-deploy-v1.xx.xx.zip`** from the latest release
3. Extract the zip file to your desired location:
   - **For local use**: e.g., `C:\TermNorm-excel\`
   - **For IIS deployment**: e.g., `C:\inetpub\wwwroot\termnorm\`

### Step 2: Prerequisites

- **Microsoft Excel** installed on your system or licence for the cloud version (Microsoft 365 subscription)
- **Python** (version 3.9+) for the backend server - [Download here](https://www.python.org/downloads/)
  - To verify: `python --version` in your terminal

### Step 3: Choose Your Deployment Method

Select the installation method that best fits your needs:

| Deployment Method | Best For | Requirements | Setup Time | Instructions |
| ----------------- | -------- | ------------ | ---------- | ------------ |
| **A: Microsoft 365 (Cloud Excel)** | Individual users with M365 subscription | Excel for the Web (browser-based) | 5 min | [3.1 365 Cloud Setup](#31-365-cloud-setup) |
| **B: Desktop Excel (Windows Server/IIS)** ⭐ | Small businesses, teams sharing a server | Windows Server with IIS, Desktop Excel | 20-30 min | [2. Windows Server Deployment](#2-windows-server-deployment) |
| **C: Desktop Excel (Local Development)** | Individual developers, testing, single-user | Desktop Excel on Windows or Mac | 10 min | [3.2 Desktop Excel Setup](#32-desktop-excel-setup-sideloading) |
| **D: For Developers** | Contributing to project, customizing code | Node.js, Git, development environment | 30+ min | [5. For Developers](#5-for-developers) |

**⭐ Recommended for teams and small businesses**


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

To configure Excel to trust and load the add-in, see **[3.2 Desktop Excel setup](#32-desktop-excel-setup-sideloading)** → Configure Trusted Add-in Catalog.

- **Important:** Use `npm run build:iis` with `DEPLOYMENT_PATH` set to ensure the UI shows correct server paths to users:
  ```bash
  set DEPLOYMENT_PATH=C:\inetpub\wwwroot\termnorm
  npm run build:iis
  ```
  This makes the add-in display "IIS Server" deployment type and show the correct filesystem paths for configuration files.

### 2.5 Troubleshooting

For troubleshooting IIS deployment issues, see the **[Troubleshooting Guide](TROUBLESHOOTING.md)** → Windows Server / IIS Deployment Issues section.

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

**Step 2: Configure Trusted Add-in Catalog (one-time setup)**
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


## 4. Next Steps

Installation is now complete!

For a quick start guide showing how to set up and use TermNorm, see the **[Setup Guide](SETUP-GUIDE.md)**.

For detailed configuration options including authentication, API keys, and advanced settings, see the **[Configuration Guide](CONFIGURATION.md)**.

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
