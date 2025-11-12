@echo off
setlocal enabledelayedexpansion

:: Detect python command (python or py)
python --version >nul 2>nul && set "PYTHON_CMD=python" || set "PYTHON_CMD=py"

:: ===============================================
:: CONFIGURATION PARAMETERS
:: ===============================================
:: Authentication: Uses IP-based authentication via backend-api/config/users.json

:: Auto-detect paths relative to script location
set "backend_path=%~dp0backend-api"
set "VENV_PATH=%~dp0backend-api\.venv"

:: Set up color codes
for /f "delims=#" %%E in ('"prompt #$E# & for %%E in (1) do rem"') do set "ESC=%%E"
prompt $P$G
set "GREEN=%ESC%[92m" & set "YELLOW=%ESC%[93m" & set "BLUE=%ESC%[94m"
set "CYAN=%ESC%[96m" & set "RED=%ESC%[91m" & set "RESET=%ESC%[0m" & set "BOLD=%ESC%[1m"

:: Logging
set "LOG_FILE=%~dp0server.log"
echo [%date% %time%] Server startup initiated >> "!LOG_FILE!"

echo ===============================================
echo       TermNorm Excel Backend Server
echo ===============================================
echo.
echo %BLUE%^>%RESET% Backend: %BOLD%%CYAN%!backend_path!%RESET%
echo %BLUE%^>%RESET% Mode: %BOLD%%GREEN%Network (0.0.0.0:8000)%RESET%
echo %BLUE%^>%RESET% Log: %CYAN%!LOG_FILE!%RESET%
echo.

:: Check directory exists
if not exist "!backend_path!" (
    echo %RED%[ERROR]%RESET% Directory does not exist: !backend_path!
    echo [%date% %time%] ERROR: Backend directory not found >> "!LOG_FILE!"
    exit /b 1
)

:: Navigate to backend directory
cd /d "!backend_path!" || (
    echo %RED%[ERROR]%RESET% Failed to change to directory: !backend_path!
    echo [%date% %time%] ERROR: Failed to cd to backend >> "!LOG_FILE!"
    exit /b 1
)

:: Virtual environment setup
echo.
echo ===============================================
echo        Virtual Environment Setup
echo ===============================================
echo.

:: Check/create virtual environment
if not exist "!VENV_PATH!" (
    echo %BLUE%^>%RESET% Creating virtual environment at: %BOLD%%CYAN%!VENV_PATH!%RESET%
    !PYTHON_CMD! -m venv "!VENV_PATH!"
    if errorlevel 1 (
        echo %RED%[ERROR]%RESET% Failed to create virtual environment
        exit /b 1
    )
    echo %GREEN%[OK]%RESET% Virtual environment created
) else (
    echo %GREEN%[OK]%RESET% Virtual environment found
)

:: Install requirements (only if needed)
echo.
set "INSTALL_MARKER=!VENV_PATH!\installed.txt"
set "NEEDS_INSTALL=0"

if not exist "!INSTALL_MARKER!" set "NEEDS_INSTALL=1"
if exist "requirements.txt" (
    for %%F in ("requirements.txt") do set "REQ_TIME=%%~tF"
    for %%F in ("!INSTALL_MARKER!") do set "MARKER_TIME=%%~tF"
    if "!REQ_TIME!" GTR "!MARKER_TIME!" set "NEEDS_INSTALL=1"
)

if "!NEEDS_INSTALL!"=="1" (
    echo %BLUE%^>%RESET% Installing/updating requirements...
    if not exist "!VENV_PATH!\Scripts\pip.exe" (
        echo %RED%[ERROR]%RESET% pip.exe not found at: !VENV_PATH!\Scripts\pip.exe
        exit /b 1
    )
    if not exist "requirements.txt" (
        echo %RED%[ERROR]%RESET% requirements.txt not found
        exit /b 1
    )
    "!VENV_PATH!\Scripts\pip.exe" install -r requirements.txt -q
    if errorlevel 1 (
        echo %YELLOW%[WARNING]%RESET% Some requirements may have failed to install
    ) else (
        echo. > "!INSTALL_MARKER!"
        echo %GREEN%[OK]%RESET% Requirements installed
    )
) else (
    echo %GREEN%[OK]%RESET% Requirements up to date
)

:: Quick validation
echo %GREEN%[OK]%RESET% Environment ready

:: Server startup
echo.
echo ===============================================
echo              Server Launch
echo ===============================================
echo.
echo +-- CONFIGURATION SUMMARY -----------------+
echo ^| Directory:   %BOLD%%CYAN%!backend_path!%RESET%
echo ^| Virtual Env: %BOLD%%CYAN%!VENV_PATH!%RESET%
echo ^| Auth:        IP-based (config/users.json)
echo +-------------------------------------------+
echo.

:server_loop
echo.
echo ===============================================
echo             Starting Server...
echo ===============================================
echo.
echo [%date% %time%] Server starting >> "!LOG_FILE!"
echo %BLUE%^>%RESET% Command: %BOLD%%GREEN%uvicorn main:app --host 0.0.0.0 --port 8000 --reload%RESET%
echo %BLUE%^>%RESET% Server accessible at: %BOLD%%CYAN%http://your-ip:8000%RESET%
echo %BLUE%^>%RESET% Press %YELLOW%Ctrl+C%RESET% to stop the server
echo.
echo %CYAN%===========================================%RESET%
"!VENV_PATH!\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

echo.
echo ===============================================
echo             Server Stopped
echo ===============================================
echo Exit code: %BOLD%%YELLOW%!errorlevel!%RESET%
echo [%date% %time%] Server stopped (exit code: !errorlevel!) >> "!LOG_FILE!"
echo.
echo %YELLOW%Auto-restarting in 5 seconds...%RESET%
echo Press Ctrl+C to exit
timeout /t 5 /nobreak >nul
goto server_loop