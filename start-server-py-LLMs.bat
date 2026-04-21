@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul

:: Detect python command (python or py)
python --version >nul 2>nul && set "PYTHON_CMD=python" || (
    py --version >nul 2>nul && set "PYTHON_CMD=py" || (
        echo ERROR: Python not found. Neither 'python' nor 'py' works.
        echo Test: py --version  OR  python --version
        echo If both fail, Python is not installed or not in PATH.
        pause
        exit /b 1
    )
)

:: Capture Python version (drop the "Python " prefix)
for /f "tokens=2" %%v in ('!PYTHON_CMD! --version 2^>^&1') do set "PYTHON_VERSION=%%v"

:: Auto-detect paths relative to script location
set "backend_path=%~dp0backend-api"
set "VENV_PATH=%~dp0backend-api\.venv"

:: ANSI colors
for /f "delims=#" %%E in ('"prompt #$E# & for %%E in (1) do rem"') do set "ESC=%%E"
prompt $P$G
set "GREEN=%ESC%[92m" & set "YELLOW=%ESC%[93m" & set "CYAN=%ESC%[96m"
set "RED=%ESC%[91m" & set "DIM=%ESC%[90m" & set "RESET=%ESC%[0m"

set "LOG_FILE=%~dp0server.log"
echo [%date% %time%] Server startup initiated >> "!LOG_FILE!"

:: Check backend dir exists
if not exist "!backend_path!" (
    echo %RED%error%RESET%  backend dir missing: !backend_path!
    echo [%date% %time%] ERROR: Backend directory not found >> "!LOG_FILE!"
    exit /b 1
)
cd /d "!backend_path!" || (
    echo %RED%error%RESET%  cannot cd to: !backend_path!
    exit /b 1
)

:: Venv — create on first run
if not exist "!VENV_PATH!" (
    echo %DIM%creating virtualenv...%RESET%
    !PYTHON_CMD! -m venv "!VENV_PATH!"
    if errorlevel 1 (
        echo %RED%error%RESET%  failed to create venv
        exit /b 1
    )
)

:: Requirements — install only if requirements.txt is newer than marker
set "INSTALL_MARKER=!VENV_PATH!\installed.txt"
set "NEEDS_INSTALL=0"
if not exist "!INSTALL_MARKER!" set "NEEDS_INSTALL=1"
if exist "requirements.txt" (
    for %%F in ("requirements.txt") do set "REQ_TIME=%%~tF"
    for %%F in ("!INSTALL_MARKER!") do set "MARKER_TIME=%%~tF"
    if "!REQ_TIME!" GTR "!MARKER_TIME!" set "NEEDS_INSTALL=1"
)

if "!NEEDS_INSTALL!"=="1" (
    echo %DIM%installing requirements...%RESET%
    if not exist "!VENV_PATH!\Scripts\pip.exe" (
        echo %RED%error%RESET%  pip.exe missing at !VENV_PATH!\Scripts\pip.exe
        exit /b 1
    )
    if not exist "requirements.txt" (
        echo %RED%error%RESET%  requirements.txt not found
        exit /b 1
    )
    "!VENV_PATH!\Scripts\pip.exe" install -r requirements.txt -q
    if errorlevel 1 (
        set "REQ_STATUS=requirements install had warnings"
    ) else (
        echo. > "!INSTALL_MARKER!"
        set "REQ_STATUS=requirements installed"
    )
) else (
    set "REQ_STATUS=requirements synced"
)

:: Launcher banner
echo.
echo %CYAN%--- TermNorm - Launcher --------------%RESET%
echo.
echo  Python  !PYTHON_VERSION!
echo          .venv ready
echo  Backend backend-api/
echo          !REQ_STATUS!
echo  Host    0.0.0.0:8000 --reload
echo  Log     server.log
echo.
echo  %DIM%booting uvicorn...%RESET%
echo.

:server_loop
echo [%date% %time%] Server starting >> "!LOG_FILE!"
"!VENV_PATH!\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

echo.
echo %CYAN%--- Server stopped - exit !errorlevel! --%RESET%
echo [%date% %time%] Server stopped (exit code: !errorlevel!) >> "!LOG_FILE!"
echo  %DIM%auto-restarting in 5s - Ctrl+C exits%RESET%
timeout /t 5 /nobreak >nul
goto server_loop
