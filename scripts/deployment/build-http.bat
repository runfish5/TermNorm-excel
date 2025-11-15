@echo off
REM Build TermNorm for HTTP (localhost:8080)

REM Change to the project root directory (two levels up from scripts\deployment\)
cd /d "%~dp0\..\.."

echo ============================================
echo   Build TermNorm for HTTP
echo ============================================
echo.
echo This will rebuild the dist folder with
echo URLs pointing to: http://localhost:8080/
echo.
echo Current directory: %CD%
echo.
pause

REM Set the deployment URL
set DEPLOYMENT_URL=http://localhost:8080/

REM Run the build
echo.
echo Building...
call npm run build

if %errorLevel% == 0 (
    echo.
    echo ============================================
    echo   BUILD COMPLETE!
    echo ============================================
    echo.
    echo The dist folder now has HTTP URLs.
    echo.
    echo Next step: Copy manifest to shared folder
    echo   copy dist\manifest.xml C:\OfficeAddIns\manifest.xml
    echo.
) else (
    echo.
    echo ERROR: Build failed!
    echo Make sure you have run "npm install" first.
    echo.
)

pause
