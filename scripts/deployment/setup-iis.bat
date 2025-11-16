@echo off
REM Setup IIS for TermNorm Excel Add-in

echo ============================================
echo   TermNorm - IIS Deployment Setup
echo ============================================
echo.
echo This will deploy TermNorm to IIS:
echo   - Copy files to C:\inetpub\wwwroot\termnorm\
echo   - Configure IIS website on port 8080
echo   - Set up HTTP hosting
echo.
echo Administrator privileges required.
echo.
pause

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process PowerShell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0deploy-to-iis.ps1' -Verb RunAs -Wait"

echo.
echo Check the PowerShell window...
pause
