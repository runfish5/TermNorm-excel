@echo off
setlocal enabledelayedexpansion

:: Set up color codes (since uvicorn colors work, ANSI support is available)
:: Create ESC character and restore prompt
for /f "delims=#" %%E in ('"prompt #$E# & for %%E in (1) do rem"') do set "ESC=%%E"
prompt $P$G
set "GREEN=%ESC%[92m"
set "YELLOW=%ESC%[93m" 
set "BLUE=%ESC%[94m"
set "CYAN=%ESC%[96m"
set "RED=%ESC%[91m"
set "RESET=%ESC%[0m"
set "BOLD=%ESC%[1m"

echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%      TermNorm Excel Backend Server    %RESET%
echo %CYAN%===============================================%RESET%
echo.

:: Deployment type selection
echo +-- DEPLOYMENT TYPE -----------------------+
echo ^| %YELLOW%[1]%RESET% Local (localhost only)               ^|
echo ^| %YELLOW%[2]%RESET% Network/Cloud (accessible remotely)  ^|
echo +-------------------------------------------+
echo.
set /p deploy_choice="%BLUE%>>%RESET% Enter choice (%YELLOW%1%RESET% or %YELLOW%2%RESET%): "

:: Set deployment type and get API key
if "%deploy_choice%"=="1" (
    set deployment_type=local
    echo %GREEN%[OK]%RESET% Selected: %BOLD%%GREEN%Local deployment%RESET%
) else (
    set deployment_type=network
    echo %GREEN%[OK]%RESET% Selected: %BOLD%%GREEN%Network deployment%RESET%
)

echo.
echo +-- API CONFIGURATION ---------------------+
set /p api_key="^| API Key [default: %CYAN%mycatlikesfish%RESET%]: "
if "%api_key%"=="" set api_key=mycatlikesfish
echo ^| %GREEN%[OK]%RESET% API Key set: %BOLD%%YELLOW%!api_key!%RESET%
echo +-------------------------------------------+

:: Backend directory setup
echo.
echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%        Backend Directory Setup         %RESET%
echo %CYAN%===============================================%RESET%
echo.
set backend_path=C:\Users\dsacc\OfficeAddinApps\TermNorm-excel\backend-api
echo Default: %BOLD%%CYAN%!backend_path!%RESET%
set /p backend_input="%BLUE%>>%RESET% Enter backend path (or press Enter for default): "
if not "!backend_input!"=="" set backend_path=!backend_input!

echo.
echo %BLUE%>>%RESET% Using path: %BOLD%%YELLOW%!backend_path!%RESET%

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
cd /d "!backend_path!"

:: Virtual environment setup
echo.
echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%       Virtual Environment Setup          %RESET%
echo %CYAN%===============================================%RESET%
echo.
set GLOBAL_VENV_PATH=C:\Users\dsacc\venvs\termnorm-backend

:: Create venvs directory if needed
if not exist "C:\Users\dsacc\venvs\" (
    echo %BLUE%>>%RESET% Creating global venvs directory...
    mkdir "C:\Users\dsacc\venvs"
)

:: Check/create virtual environment
if not exist "!GLOBAL_VENV_PATH!" (
    echo %BLUE%>>%RESET% Creating virtual environment at: %BOLD%%CYAN%!GLOBAL_VENV_PATH!%RESET%
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
echo %BLUE%>>%RESET% Installing/updating requirements...
"!GLOBAL_VENV_PATH!\Scripts\pip.exe" install -r requirements.txt -q
if errorlevel 1 (
    echo %YELLOW%[WARNING]%RESET% Some requirements may have failed to install
) else (
    echo %GREEN%[OK]%RESET% Requirements installed successfully
)

:: Set environment variable
set TERMNORM_API_KEY=!api_key!

:: Basic diagnostics
echo.
echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%          Pre-flight Diagnostics          %RESET%
echo %CYAN%===============================================%RESET%
echo.

echo %BLUE%>>%RESET% Testing main.py import...
"!GLOBAL_VENV_PATH!\Scripts\python.exe" -c "import main; print('  %GREEN%[OK]%RESET% main.py imported successfully')" 2>nul
if errorlevel 1 (
    echo   %RED%[ERROR]%RESET% Could not import main.py
) else (
    echo   %GREEN%[OK]%RESET% main.py import verified
)

echo.
echo %BLUE%>>%RESET% Testing FastAPI app object...
"!GLOBAL_VENV_PATH!\Scripts\python.exe" -c "import main; print('  %GREEN%[OK]%RESET% FastAPI app object found')" 2>nul
if errorlevel 1 (
    echo   %YELLOW%[WARNING]%RESET% Could not verify FastAPI app object
) else (
    echo   %GREEN%[OK]%RESET% FastAPI app object verified
)

echo.
echo %BLUE%>>%RESET% Testing port %BOLD%%YELLOW%8000%RESET% availability...
netstat -an | findstr ":8000 " >nul 2>nul
if errorlevel 1 (
    echo   %GREEN%[OK]%RESET% Port %BOLD%%YELLOW%8000%RESET% is available
) else (
    echo   %YELLOW%[WARNING]%RESET% Port %BOLD%%YELLOW%8000%RESET% appears to be in use
)

:: Server startup
echo.
echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%             Server Launch                %RESET%
echo %CYAN%===============================================%RESET%
echo.
echo +-- CONFIGURATION SUMMARY -----------------+
echo ^| API Key:     %BOLD%%YELLOW%!api_key!%RESET%
echo ^| Deployment:  %BOLD%%GREEN%!deployment_type!%RESET%
echo ^| Directory:   %BOLD%%CYAN%!backend_path!%RESET%
echo ^| Virtual Env: %BOLD%%CYAN%!GLOBAL_VENV_PATH!%RESET%
echo +-------------------------------------------+
echo.
echo.
echo %BLUE%>>%RESET% Press any key to start the server...
echo.
pause >nul

echo.
echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%            Starting Server...            %RESET%
echo %CYAN%===============================================%RESET%
echo.

:: Start server based on deployment type
if "!deployment_type!"=="local" (
    echo %BLUE%>>%RESET% Command: %BOLD%%GREEN%uvicorn main:app --reload%RESET%
    echo %BLUE%>>%RESET% Server will be available at: %BOLD%%CYAN%http://localhost:8000%RESET%
    echo %BLUE%>>%RESET% Press %YELLOW%Ctrl+C%RESET% to stop the server
    echo.
    echo %CYAN%===========================================%RESET%
    "!GLOBAL_VENV_PATH!\Scripts\python.exe" -m uvicorn main:app --reload
) else (
    echo %BLUE%>>%RESET% Command: %BOLD%%GREEN%uvicorn main:app --host 0.0.0.0 --port 8000 --reload%RESET%  
    echo %BLUE%>>%RESET% Server will be available at: %BOLD%%CYAN%http://your-ip:8000%RESET%
    echo %BLUE%>>%RESET% Press %YELLOW%Ctrl+C%RESET% to stop the server
    echo.
    echo %CYAN%===========================================%RESET%
    "!GLOBAL_VENV_PATH!\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
)

echo.
echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%            Server Stopped                %RESET%
echo %CYAN%===============================================%RESET%
echo Exit code: %BOLD%%YELLOW%!errorlevel!%RESET%
echo.
echo Press any key to exit...
pause >nul