@echo off
setlocal EnableDelayedExpansion

:: Check if running as administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Running with Administrator privileges
    echo.
    echo Please enter the admin password for additional security:
    set /p admin_password="Admin Password: "
    if "!admin_password!"=="" (
        echo No password entered. Exiting.
        pause
        exit /b 1
    )
) else (
    echo Running with standard user privileges
)

echo.
echo ===========================================
echo     TermNorm Excel Backend Server
echo ===========================================
echo.

:: Ask for deployment type
echo Choose deployment type:
echo [1] Local (localhost only)
echo [2] Network/Cloud (accessible from other devices)
echo.
set /p deploy_choice="Enter choice (1 or 2): "

if "!deploy_choice!"=="1" (
    set deployment_type=local
    echo Selected: Local deployment
) else if "!deploy_choice!"=="2" (
    set deployment_type=network
    echo Selected: Network deployment
    echo.
    set /p api_key="Enter API key (or press Enter for default 'mycatlikesfish'): "
    if "!api_key!"=="" set api_key=mycatlikesfish
) else (
    echo Invalid choice. Defaulting to local deployment.
    set deployment_type=local
)

echo.
echo ===========================================
echo     Backend Directory Setup
echo ===========================================
echo.

:: Ask for backend directory path
echo Please enter the path to your backend-api directory:
echo Default: C:\Users\dsacc\OfficeAddinApps\TermNorm-excel\backend-api
echo.
set /p backend_path="Enter path (or press Enter for default): "

:: Use default if no input provided
if "!backend_path!"=="" (
    set backend_path=C:\Users\dsacc\OfficeAddinApps\TermNorm-excel\backend-api
    echo Using default path: !backend_path!
) else (
    echo Using provided path: !backend_path!
)

echo.
echo Checking if directory exists...

:: Check if directory exists
if not exist "!backend_path!" (
    echo.
    echo ERROR: Directory does not exist: !backend_path!
    echo Please check the path and try again.
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

:: Navigate to the backend directory
echo Directory found! Navigating to: !backend_path!
cd /d "!backend_path!"
if %errorLevel% neq 0 (
    echo Error: Could not navigate to directory. Please check permissions.
    echo.
    echo Press any key to exit...
    pause >nul
    exit /b 1
)

echo.
echo Setting up environment...

:: Check if virtual environment exists, if not create it
if not exist "venv\" (
    echo Creating virtual environment...
    python -m venv venv
    if %errorLevel% neq 0 (
        echo Error: Failed to create virtual environment. Make sure Python is installed.
        pause
        exit /b 1
    )
)

:: Activate virtual environment
echo Activating virtual environment...
call .\venv\Scripts\activate.bat
if %errorLevel% neq 0 (
    echo Error: Failed to activate virtual environment.
    pause
    exit /b 1
)

:: Install requirements if requirements.txt exists
if exist "requirements.txt" (
    echo Installing/updating requirements...
    pip install -r requirements.txt
    if %errorLevel% neq 0 (
        echo Warning: Some requirements may have failed to install.
        echo Press any key to continue anyway...
        pause >nul
    )
) else (
    echo Warning: requirements.txt not found. Skipping dependency installation.
)

echo.
echo Environment setup complete!
echo Current directory: %CD%
echo Virtual environment: ACTIVATED
echo Python version:
python --version
echo.
echo Press any key to start the server...
pause >nul

echo.
echo Starting server...
echo.

:: Start server based on deployment type
if "!deployment_type!"=="local" (
    echo Starting local server (http://localhost:8000)...
    echo Press Ctrl+C to stop the server
    echo.
    python -m uvicorn main:app --reload
) else (
    echo Starting network server (accessible at http://your-ip:8000)...
    echo API Key: !api_key!
    echo Press Ctrl+C to stop the server
    echo.
    set TERMNORM_API_KEY=!api_key!
    python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
)

echo.
echo Server stopped.
pause