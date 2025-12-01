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

## 1. 📦 Installation

### Step 1: Download the Release Package

**Download the pre-built application files:**

1. Visit the releases page: **https://github.com/runfish5/TermNorm-excel/releases**
2. Download **`termnorm-deploy-v1.xx.xx.zip`** from the latest release
3. Extract the zip file to your desired location:
   - **For local use**: e.g., `C:\termnorm-excel\`
   - **For IIS deployment**: e.g., `C:\inetpub\wwwroot\termnorm\`

### Step 2: Prerequisites

- **Microsoft Excel** installed on your system or licence for the cloud version (Microsoft 365 subscription)
- **Python** (version 3.9+) for the backend server - [Download here](https://www.python.org/downloads/)
  - To verify: `python --version` in your terminal

### Step 3: Choose Your Deployment Method

Select the scenario that matches your environment:

| Scenario | Best For | Architecture | Setup Time | Go To Section |
| :--- | :--- | :--- | :--- | :--- |
| **1. Cloud (Microsoft 365)** | **Most Users** <br> (Simplest setup) | **Web-based** <br> No server required | ~5 min | [M365 Cloud Deployment](#21-microsoft-365-cloud-excel-deployment--easiest) |
| **2. Individual / Standalone** | **Single Users** <br> (No server access) | **Local Network Share** <br> Runs from your PC | ~10 min | [Desktop Excel Setup](#22-desktop-excel-setup-sideloading) |
| **3. Enterprise / Team** | **Organizations** <br> (Centralized IT management) | **IIS Server + Network Share** <br> Hosted on Windows Server | ~30 min | [Windows Server Hosting](#3-windows-server-hosting-optional-enterprise-extension) |

> **Which one do I need?**
> *   **Option 1** is for modern Excel (Web or M365).
> *   **Option 2 & 3** are for **Desktop Excel** users who need to "sideload" the add-in.
>     *   Choose **Option 2** if you have a Windows Server and want to host it centrally for a team.
>     *   Choose **Option 3** if you are just one person running it on your own machine.

## 2.1 Microsoft 365 (Cloud Excel) Deployment ⭐ EASIEST

**⭐ RECOMMENDED: Easiest deployment method**

**Audience:** Users with Microsoft 365 subscription (Excel for the Web or Desktop with M365)

**What you need:**
- Download the release package (from Step 1 above)
- Start the backend server
- Upload manifest to Excel

### Steps:

1. **Download the manifest file:**
   - Extract `termnorm-deploy-v1.xx.xx.zip` (from Installation Step 1 above)
   - Locate `manifest-cloud.xml` inside the extracted folder

2. **Upload to Excel:**
   - In Excel 'Home' tab, click on 'Add-ins' → 'My Add-ins' → 'Upload my Add-in'
   - Browse and select the `manifest-cloud.xml` file
   - Click **Open**

3. **Verify installation:**
   - The TermNorm task pane should appear on the right side
   - If not visible, check that you're using Excel for the Web (not Desktop)


## 2.2 Desktop Excel Setup (Sideloading)

**⭐ Start here for any Desktop Excel deployment**

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
1. Extract `termnorm-deploy-v1.xx.xx.zip` (from Installation Step 1 above)
2. Locate `manifest.xml` inside the extracted folder

**Step 4: Install Add-in**
1. Copy the downloaded `manifest.xml` to your shared folder (e.g., `C:\OfficeAddIns\`)
2. Open Excel
3. **Home** → **Add-ins** → **More Add-ins**
4. Select **SHARED FOLDER** at the top of the dialog
5. Select the add-in and click **Add**


## 3. Windows Server Hosting (Optional Enterprise Extension)

**⚠️ PREREQUISITE:** Complete Section 2.2 above first. This section adds server hosting to the sideloading setup.

**Audience:** IT Administrators deploying for teams/organizations

**Overview:**

This section describes the **standard Microsoft-recommended approach** for deploying Office add-ins on internal networks using IIS and network share catalogs. This EXTENDS the basic sideloading setup from Section 2.2 by adding centralized IIS hosting.

The deployment uses:
- **IIS (Internet Information Services)** - Built into Windows Server for hosting static files
- **Network Shared Folder Catalog** - Microsoft's recommended method for enterprise sideloading (configured in Section 2.2)
- **HTTP hosting** - Acceptable for internal networks (HTTPS optional)

This is the industry-standard approach documented in [Microsoft's official Office Add-ins deployment guide](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins).

**Prerequisites:**

1. **Windows Server** with IIS enabled
   - Open Server Manager → Add Roles and Features
   - Select **Web Server (IIS)** role
   - Include **Management Tools** and **Static Content** features

2. **Network share configured** for manifest distribution (see Section 2.2)
   - Create folder (e.g., `C:\OfficeAddIns`)
   - Share with users (Read permissions)
   - Note the UNC path (e.g., `\\SERVERNAME\OfficeAddIns`)

3. **Downloaded release package** from Step 1 above
   - Extract `termnorm-deploy-v1.xx.xx.zip` to a temporary location

**Server Setup Steps:**

**Step 1: Extract the Release Package**

Extract the downloaded `termnorm-deploy-v1.xx.xx.zip` to a temporary location (e.g., `C:\downloads\termnorm\`)

**Step 2: Deploy to IIS** *(Requires Administrator)*

1. Open PowerShell as Administrator (Right-click Start → PowerShell → Run as Administrator)

2. Copy and paste these commands:

```powershell
$src = "C:\downloads\termnorm\dist"  # Or your actual extraction path
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

3. Replace `C:\downloads\termnorm\dist` with your actual extraction path (must point to the `dist` subdirectory)

4. Verify deployment:
   - Files should be in `C:\inetpub\wwwroot\termnorm\`
   - Browser should open to `http://localhost:8080/taskpane.html`
   - Check file dates match today's date

**Step 3: Distribute Manifest to Network Share**

Copy the manifest from IIS to your network share:
```bash
copy C:\inetpub\wwwroot\termnorm\manifest-iis.xml \\SERVERNAME\OfficeAddIns\
```

**Troubleshooting:**

For troubleshooting IIS deployment issues, see the **[Troubleshooting Guide](TROUBLESHOOTING.md)** → Windows Server / IIS Deployment Issues section.

## 4. Next Steps

Installation is now complete!

For a quick start guide showing how to use TermNorm, see the **[Setup Guide](SETUP-GUIDE.md)**.

## 5. Version Control and Security

### 5.1 📦 Official Releases Only

**IMPORTANT:** Download files exclusively from official releases:
- **Release page:** https://github.com/runfish5/TermNorm-excel/releases

### 5.2 🆘 Support

- Contact: uniqued4ve@gmail.com
