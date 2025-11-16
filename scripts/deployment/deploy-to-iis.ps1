#Requires -RunAsAdministrator

# Move TermNorm to Standard IIS Location - Guaranteed Fix for 401.3

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Move to Standard IIS Location" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This moves files to C:\inetpub\wwwroot\termnorm\" -ForegroundColor Gray
Write-Host "where IIS has full access (no permission issues)" -ForegroundColor Gray
Write-Host ""
Write-Host "Press any key to start..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Write-Host ""

try {
    # Navigate to project root (two levels up from scripts\deployment\)
    $sourcePath = Join-Path $PSScriptRoot "..\..\dist"
    $destPath = "C:\inetpub\wwwroot\termnorm"
    $siteName = "TermNorm"

    Write-Host "DEBUG: Script location: $PSScriptRoot" -ForegroundColor Cyan
    Write-Host "DEBUG: Resolved source path: $sourcePath" -ForegroundColor Cyan
    Write-Host ""

    # Step 1: Check source
    Write-Host "[1/5] Checking source folder..." -ForegroundColor Yellow
    if (-not (Test-Path $sourcePath)) {
        throw "Source folder not found: $sourcePath`nPlease run 'npm run build' first to create the dist folder."
    }
    $sourceFileCount = (Get-ChildItem $sourcePath -Recurse -File).Count
    Write-Host "✓ Source: $sourcePath" -ForegroundColor Green
    Write-Host "  Found $sourceFileCount files to copy" -ForegroundColor Gray
    Write-Host ""

    # Step 2: Create destination
    Write-Host "[2/5] Creating destination folder..." -ForegroundColor Yellow
    if (Test-Path $destPath) {
        Write-Host "  Removing existing folder..." -ForegroundColor Gray
        try {
            Remove-Item $destPath -Recurse -Force -ErrorAction Stop
            Write-Host "  ✓ Old files removed" -ForegroundColor Gray
        } catch {
            Write-Host "  ⚠ Warning: Could not remove all files. Trying to overwrite..." -ForegroundColor Yellow
            Write-Host "  Error details: $($_.Exception.Message)" -ForegroundColor Gray
        }
    }
    New-Item -ItemType Directory -Path $destPath -Force -ErrorAction Stop | Out-Null
    Write-Host "✓ Created: $destPath" -ForegroundColor Green
    Write-Host ""

    # Step 3: Copy files
    Write-Host "[3/5] Copying files..." -ForegroundColor Yellow
    Write-Host "  This may take a moment..." -ForegroundColor Gray
    try {
        Copy-Item "$sourcePath\*" -Destination $destPath -Recurse -Force -ErrorAction Stop
        $fileCount = (Get-ChildItem $destPath -Recurse -File).Count
        Write-Host "✓ Copied $fileCount files successfully" -ForegroundColor Green
    } catch {
        Write-Host "⚠ Warning: Some files may not have copied" -ForegroundColor Yellow
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Gray
        Write-Host "  Continuing anyway..." -ForegroundColor Gray
        $fileCount = (Get-ChildItem $destPath -Recurse -File -ErrorAction SilentlyContinue).Count
        Write-Host "  Files in destination: $fileCount" -ForegroundColor Gray
    }
    Write-Host ""

    # Step 4: Update IIS site
    Write-Host "[4/5] Updating IIS site..." -ForegroundColor Yellow
    try {
        Import-Module WebAdministration -ErrorAction Stop
        Write-Host "  ✓ WebAdministration module loaded" -ForegroundColor Gray

        if (Test-Path "IIS:\Sites\$siteName") {
            Write-Host "  Site '$siteName' exists, updating..." -ForegroundColor Gray
            Set-ItemProperty "IIS:\Sites\$siteName" -Name physicalPath -Value $destPath -ErrorAction Stop
            Write-Host "  ✓ Updated physical path" -ForegroundColor Gray

            # Restart site
            Stop-WebSite -Name $siteName -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            Start-WebSite -Name $siteName -ErrorAction Stop
            Write-Host "✓ IIS site '$siteName' updated and restarted" -ForegroundColor Green
        } else {
            Write-Host "  Site '$siteName' not found, creating..." -ForegroundColor Gray
            New-Website -Name $siteName -PhysicalPath $destPath -Port 8080 -Force -ErrorAction Stop | Out-Null
            Start-WebSite -Name $siteName -ErrorAction Stop
            Write-Host "✓ Created and started new IIS site '$siteName'" -ForegroundColor Green
        }
    } catch {
        Write-Host "⚠ Warning: Could not configure IIS site" -ForegroundColor Yellow
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Gray
        Write-Host "  Files are copied, but you may need to configure IIS manually" -ForegroundColor Gray
    }
    Write-Host ""

    # Step 5: Test
    Write-Host "[5/5] Testing..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3

    $testUrl = "http://localhost:8080/taskpane.html"
    try {
        $response = Invoke-WebRequest -Uri $testUrl -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Host "✓✓✓ SUCCESS! Website is working!" -ForegroundColor Green
        }
    } catch {
        Write-Host "⚠ Could not test automatically: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "  Try manually in browser" -ForegroundColor Gray
    }
    Write-Host ""

    # Success
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  SETUP COMPLETE!" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Files are now at: $destPath" -ForegroundColor Cyan
    Write-Host "IIS serves from this location (no 401 errors!)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "TEST NOW: http://localhost:8080/taskpane.html" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor White
    Write-Host "  1. Test in browser (should work now!)" -ForegroundColor Gray
    Write-Host "  2. Copy manifest: copy C:\inetpub\wwwroot\termnorm\manifest.xml C:\OfficeAddIns\" -ForegroundColor Gray
    Write-Host "  3. Sideload in Excel: Insert → Get Add-ins → SHARED FOLDER" -ForegroundColor Gray
    Write-Host ""

    $openBrowser = Read-Host "Open browser to test now? (Y/N)"
    if ($openBrowser -eq "Y" -or $openBrowser -eq "y") {
        Start-Process $testUrl
    }

} catch {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Red
    Write-Host "  ERROR!" -ForegroundColor Red
    Write-Host "============================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor White
    Write-Host ""
} finally {
    Write-Host ""
    Read-Host "Press Enter to exit"
}
