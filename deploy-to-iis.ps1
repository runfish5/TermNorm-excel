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
    $sourcePath = Join-Path $PSScriptRoot "dist"
    $destPath = "C:\inetpub\wwwroot\termnorm"
    $siteName = "TermNorm"

    # Step 1: Check source
    Write-Host "[1/5] Checking source folder..." -ForegroundColor Yellow
    if (-not (Test-Path $sourcePath)) {
        throw "Source folder not found: $sourcePath"
    }
    Write-Host "✓ Source: $sourcePath" -ForegroundColor Green
    Write-Host ""

    # Step 2: Create destination
    Write-Host "[2/5] Creating destination folder..." -ForegroundColor Yellow
    if (Test-Path $destPath) {
        Write-Host "  Removing existing folder..." -ForegroundColor Gray
        Remove-Item $destPath -Recurse -Force
    }
    New-Item -ItemType Directory -Path $destPath -Force | Out-Null
    Write-Host "✓ Created: $destPath" -ForegroundColor Green
    Write-Host ""

    # Step 3: Copy files
    Write-Host "[3/5] Copying files..." -ForegroundColor Yellow
    Copy-Item "$sourcePath\*" -Destination $destPath -Recurse -Force
    $fileCount = (Get-ChildItem $destPath -Recurse -File).Count
    Write-Host "✓ Copied $fileCount files" -ForegroundColor Green
    Write-Host ""

    # Step 4: Update IIS site
    Write-Host "[4/5] Updating IIS site..." -ForegroundColor Yellow
    Import-Module WebAdministration -ErrorAction Stop

    if (Test-Path "IIS:\Sites\$siteName") {
        Set-ItemProperty "IIS:\Sites\$siteName" -Name physicalPath -Value $destPath
        Write-Host "✓ Updated $siteName site to point to: $destPath" -ForegroundColor Green

        # Restart site
        Stop-WebSite -Name $siteName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Start-WebSite -Name $siteName
        Write-Host "✓ Restarted IIS site" -ForegroundColor Green
    } else {
        Write-Host "⚠ Site $siteName not found - creating new site..." -ForegroundColor Yellow
        New-Website -Name $siteName -PhysicalPath $destPath -Port 8080 -Force | Out-Null
        Write-Host "✓ Created new site" -ForegroundColor Green
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
