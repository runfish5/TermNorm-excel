@echo off
setlocal enabledelayedexpansion

:: ===============================================
:: CONFIGURATION PARAMETERS
:: ===============================================
set "DEFAULT_BACKEND_PATH=C:\Users\dsacc\OfficeAddinApps\TermNorm-excel\backend-api"
set "DEFAULT_API_KEY=mycatlikesfish"
set "DEFAULT_VENV_PATH=C:\Users\dsacc\venvs\termnorm-backend"
set "DEFAULT_DEPLOYMENT=network"

:: Set up color codes (ANSI support works fine for most commands)
:: Create ESC character and restore prompt
for /f "delims=#" %%E in ('"prompt #$E# & for %%E in (1) do rem"') do set "ESC=%%E"
prompt $P$G
set "GREEN=%ESC%[92m"
set "YELLOW=%ESC%[93m"
set "BLUE=%ESC%[94m"
set "CYAN=%ESC%[96m"
set "WHITE=%ESC%[97m"
set "RED=%ESC%[91m"
set "RESET=%ESC%[0m"
set "BOLD=%ESC%[1m"

echo ===============================================
echo       TermNorm Excel Backend Server v2
echo           (Restructured Architecture)
echo ===============================================
echo.

:: Deployment type selection
echo +-- DEPLOYMENT TYPE -----------------------+
echo ^| %YELLOW%[1]%RESET% Local (localhost only)               ^|
echo ^| %YELLOW%[2]%RESET% Network/Cloud (accessible remotely)  ^|
echo.
set /p deploy_choice="%BLUE%>%RESET% Enter choice (%YELLOW%1%RESET% or %YELLOW%2%RESET%): "

:: Set deployment type and get API key
if "%deploy_choice%"=="1" (
    set deployment_type=local
    echo Selected: %BOLD%%GREEN%Local deployment%RESET%
) else (
    set deployment_type=network
    echo Selected: %BOLD%%GREEN%Network deployment%RESET%
)

echo.
echo +-- API CONFIGURATION ---------------------+
set /p api_key="%BLUE%^>%RESET% API Key [default: %CYAN%!DEFAULT_API_KEY!%RESET%]: "
if "%api_key%"=="" set api_key=!DEFAULT_API_KEY!
echo Using API Key: %BOLD%%YELLOW%!api_key!%RESET%

:: Backend directory setup
echo.
echo ===============================================
echo         Backend Directory Setup
echo ===============================================
echo.
set backend_path=!DEFAULT_BACKEND_PATH!
echo Default: %BOLD%%CYAN%!backend_path!%RESET%
set /p backend_input="%BLUE%>%RESET% Enter backend path (or press Enter for default): "
if not "!backend_input!"=="" set backend_path=!backend_input!

echo.
echo %BLUE%^>%RESET% Using path: %BOLD%%YELLOW%!backend_path!%RESET%

:: Check directory exists
if not exist "!backend_path!" (
    echo.
    echo %RED%[ERROR]%RESET% Directory does not exist: %BOLD%%RED%!backend_path!%RESET%
    echo.
    pause
    exit /b 1
)
echo %GREEN%[OK]%RESET% Directory validated

:: Navigate to backend directory
echo %BLUE%^>%RESET% Changing to directory: %BOLD%%CYAN%!backend_path!%RESET%
cd /d "!backend_path!" || (
    echo %RED%[ERROR]%RESET% Failed to change to directory: %BOLD%%RED%!backend_path!%RESET%
    pause
    exit /b 1
)

:: Virtual environment setup
echo.
echo ===============================================
echo        Virtual Environment Setup
echo ===============================================
echo.
set GLOBAL_VENV_PATH=!DEFAULT_VENV_PATH!

:: Create venvs directory if needed
if not exist "C:\Users\dsacc\venvs\" (
    echo %BLUE%^>%RESET% Creating global venvs directory...
    mkdir "C:\Users\dsacc\venvs"
)

:: Check/create virtual environment
if not exist "!GLOBAL_VENV_PATH!" (
    echo %BLUE%^>%RESET% Creating virtual environment at: %BOLD%%CYAN%!GLOBAL_VENV_PATH!%RESET%
    python -m venv "!GLOBAL_VENV_PATH!"
    if errorlevel 1 (
        echo %RED%[ERROR]%RESET% Failed to create virtual environment
        pause
        exit /b 1
    )
    echo %GREEN%[OK]%RESET% Virtual environment created
) else (
    echo %GREEN%[OK]%RESET% Virtual environment found
)

:: Install requirements
echo.
echo %BLUE%^>%RESET% Installing/updating requirements...
if not exist "!GLOBAL_VENV_PATH!\Scripts\pip.exe" (
    echo %RED%[ERROR]%RESET% pip.exe not found at: %BOLD%%RED%!GLOBAL_VENV_PATH!\Scripts\pip.exe%RESET%
    pause
    exit /b 1
)
if not exist "requirements.txt" (
    echo %RED%[ERROR]%RESET% requirements.txt not found in current directory
    pause
    exit /b 1
)
"!GLOBAL_VENV_PATH!\Scripts\pip.exe" install -r requirements.txt -q
if errorlevel 1 (
    echo %YELLOW%[WARNING]%RESET% Some requirements may have failed to install
)

:: Set environment variables
set TERMNORM_API_KEY=!api_key!
echo %BLUE%^>%RESET% Set TERMNORM_API_KEY environment variable

:: Enhanced diagnostics for new architecture
echo.
echo ===============================================
echo        Enhanced Pre-flight Diagnostics
echo ===============================================
echo.

echo %BLUE%^>%RESET% Testing main.py import...
if not exist "main.py" (
    echo   %RED%[ERROR]%RESET% main.py file not found in current directory
    goto :diagnostics_failed
) else (
    "!GLOBAL_VENV_PATH!\Scripts\python.exe" -c "import main" >nul 2>nul
    if errorlevel 1 (
        echo   %RED%[ERROR]%RESET% Could not import main.py - detailed error:
        "!GLOBAL_VENV_PATH!\Scripts\python.exe" -c "import main" 2>&1
        goto :diagnostics_failed
    ) else (
        echo   %GREEN%[OK]%RESET% main.py imports successfully
    )
)

echo %BLUE%^>%RESET% Testing FastAPI app object...
"!GLOBAL_VENV_PATH!\Scripts\python.exe" -c "import main; app = main.app" >nul 2>nul
if errorlevel 1 (
    echo   %YELLOW%[WARNING]%RESET% Could not verify FastAPI app object - check main.py has 'app' variable
) else (
    echo   %GREEN%[OK]%RESET% FastAPI app object found
)

echo %BLUE%^>%RESET% Testing new backend structure...
if not exist "config\" (
    echo   %RED%[ERROR]%RESET% config/ directory missing
    goto :diagnostics_failed
)
if not exist "routers\" (
    echo   %RED%[ERROR]%RESET% routers/ directory missing
    goto :diagnostics_failed
)
if not exist "services\" (
    echo   %RED%[ERROR]%RESET% services/ directory missing
    goto :diagnostics_failed
)
if not exist "models\" (
    echo   %RED%[ERROR]%RESET% models/ directory missing
    goto :diagnostics_failed
)
echo   %GREEN%[OK]%RESET% New backend structure validated

echo %BLUE%^>%RESET% Testing configuration loading...
"!GLOBAL_VENV_PATH!\Scripts\python.exe" -c "from config import settings; print('Settings loaded successfully')" >nul 2>nul
if errorlevel 1 (
    echo   %RED%[ERROR]%RESET% Configuration loading failed
    goto :diagnostics_failed
) else (
    echo   %GREEN%[OK]%RESET% Configuration loading successful
)

echo %BLUE%^>%RESET% Testing port %BOLD%%YELLOW%8000%RESET% availability...
netstat -an | findstr ":8000 " >nul 2>nul
if not errorlevel 1 (
    echo   %YELLOW%[WARNING]%RESET% Port %BOLD%%YELLOW%8000%RESET% appears to be in use
) else (
    echo   %GREEN%[OK]%RESET% Port 8000 is available
)

goto :server_launch

:diagnostics_failed
echo.
echo %RED%[CRITICAL]%RESET% Pre-flight diagnostics failed
echo %BLUE%^>%RESET% Please check the error messages above and fix the issues
echo.
pause
exit /b 1

:: Server startup
:server_launch
echo.
echo ===============================================
echo              Server Launch
echo ===============================================
echo.
echo +-- CONFIGURATION SUMMARY -----------------+
echo ^| API Key:     %BOLD%%YELLOW%!api_key!%RESET%
echo ^| Deployment:  %BOLD%%GREEN%!deployment_type!%RESET%
echo ^| Directory:   %BOLD%%CYAN%!backend_path!%RESET%
echo ^| Virtual Env: %BOLD%%CYAN%!GLOBAL_VENV_PATH!%RESET%
echo ^| Architecture: %BOLD%%GREEN%Restructured (v2)%RESET%
echo +-------------------------------------------+
echo.
echo.
echo %BLUE%^>%RESET% Press any key to start the server...
echo.
pause >nul

:server_loop
echo.
echo ===============================================
echo             Starting Server...
echo ===============================================
echo.

:: Start server based on deployment type
if "!deployment_type!"=="local" (
    echo %BLUE%^>%RESET% Command: %BOLD%%GREEN%uvicorn main:app --reload%RESET%
    echo %BLUE%^>%RESET% Server will be available at: %BOLD%%CYAN%http://localhost:8000%RESET%
    echo %BLUE%^>%RESET% API Documentation: %BOLD%%CYAN%http://localhost:8000/docs%RESET%
    echo %BLUE%^>%RESET% Press %YELLOW%Ctrl+C%RESET% to stop the server
    echo.
    echo %CYAN%===========================================%RESET%
    "!GLOBAL_VENV_PATH!\Scripts\python.exe" -m uvicorn main:app --reload
) else (
    echo %BLUE%^>%RESET% Command: %BOLD%%GREEN%uvicorn main:app --host 0.0.0.0 --port 8000 --reload%RESET%
    echo %BLUE%^>%RESET% Server will be available at: %BOLD%%CYAN%http://your-ip:8000%RESET%
    echo %BLUE%^>%RESET% API Documentation: %BOLD%%CYAN%http://your-ip:8000/docs%RESET%
    echo %BLUE%^>%RESET% Press %YELLOW%Ctrl+C%RESET% to stop the server
    echo.
    echo %CYAN%===========================================%RESET%
    "!GLOBAL_VENV_PATH!\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
)

echo.
echo ===============================================
echo             Server Stopped
echo ===============================================
echo Exit code: %BOLD%%YELLOW%!errorlevel!%RESET%
echo.
echo %BLUE%^>%RESET% Press %YELLOW%Enter%RESET% to restart server, or any other key to exit...
set /p restart=
if "%restart%"=="" goto server_loop
echo.
echo Exiting...
pause >nul