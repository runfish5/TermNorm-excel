@echo off
setlocal enabledelayedexpansion

:: ===============================================
:: CONFIGURATION PARAMETERS
:: ===============================================
set "DEFAULT_BACKEND_PATH=C:\Users\dsacc\OfficeAddinApps\TermNorm-excel\backend-api"
set "DEFAULT_API_KEY=mycatlikesfish" :: Simple development default only
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
set /p deploy_choice="%BLUE%^>%RESET% Enter choice (%YELLOW%1%RESET% or %YELLOW%2%RESET%): "

:: Set deployment type and API key
if "%deploy_choice%"=="1" (set deployment_type=local & echo %GREEN%[OK]%RESET% Selected: %BOLD%%GREEN%Local deployment%RESET%) else (set deployment_type=network & echo %GREEN%[OK]%RESET% Selected: %BOLD%%GREEN%Network deployment%RESET%)
echo.
echo +-- API CONFIGURATION ---------------------+
set /p api_key="%BLUE%^>%RESET% API Key [default: %CYAN%!DEFAULT_API_KEY!%RESET%]: "
if "%api_key%"=="" set api_key=!DEFAULT_API_KEY!
echo %GREEN%[OK]%RESET% API Key set: %BOLD%%YELLOW%!api_key!%RESET%
echo +-------------------------------------------+

:: Backend directory setup
echo.
echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%        Backend Directory Setup         %RESET%
echo %CYAN%===============================================%RESET%
set backend_path=!DEFAULT_BACKEND_PATH!
echo.
echo Default: %BOLD%%CYAN%!backend_path!%RESET%
set /p backend_input="%BLUE%^>%RESET% Enter backend path (or press Enter for default): "
if not "!backend_input!"=="" set backend_path=!backend_input!
echo %BLUE%^>%RESET% Using path: %BOLD%%YELLOW%!backend_path!%RESET%

:: Check and navigate to directory
if not exist "!backend_path!" (echo. & echo %RED%[ERROR]%RESET% Directory does not exist: %BOLD%%RED%!backend_path!%RESET% & echo. & pause & exit /b 1)
echo %GREEN%[OK]%RESET% Directory validated
echo %BLUE%^>%RESET% Changing to directory: %BOLD%%CYAN%!backend_path!%RESET%
cd /d "!backend_path!" || (echo %RED%[ERROR]%RESET% Failed to change to directory: %BOLD%%RED%!backend_path!%RESET% & pause & exit /b 1)

:: Virtual environment setup
echo.
echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%       Virtual Environment Setup          %RESET%
echo %CYAN%===============================================%RESET%
set GLOBAL_VENV_PATH=!DEFAULT_VENV_PATH!
if not exist "C:\Users\dsacc\venvs\" (echo %BLUE%^>%RESET% Creating global venvs directory... & mkdir "C:\Users\dsacc\venvs")

:: Check/create virtual environment
echo.
if not exist "!GLOBAL_VENV_PATH!" (echo %BLUE%^>%RESET% Creating virtual environment at: %BOLD%%CYAN%!GLOBAL_VENV_PATH!%RESET% & python -m venv "!GLOBAL_VENV_PATH!" & if errorlevel 1 (echo %RED%[ERROR]%RESET% Failed to create virtual environment & pause & exit /b 1) & echo %GREEN%[OK]%RESET% Virtual environment created) else (echo %GREEN%[OK]%RESET% Virtual environment found)

:: Install requirements
echo %BLUE%^>%RESET% Installing/updating requirements...
if not exist "!GLOBAL_VENV_PATH!\Scripts\pip.exe" (echo %RED%[ERROR]%RESET% pip.exe not found at: %BOLD%%RED%!GLOBAL_VENV_PATH!\Scripts\pip.exe%RESET% & pause & exit /b 1)
if not exist "requirements.txt" (echo %RED%[ERROR]%RESET% requirements.txt not found in current directory & pause & exit /b 1)
"!GLOBAL_VENV_PATH!\Scripts\pip.exe" install -r requirements.txt -q
if errorlevel 1 (echo %YELLOW%[WARNING]%RESET% Some requirements may have failed to install) else (echo %GREEN%[OK]%RESET% Requirements installed successfully)

:: Set environment variables and IP whitelist with roles
set TERMNORM_API_KEY=!api_key!
set ALLOWED_IPS=127.0.0.1,192.168.1.100,10.0.0.15
set "IP_127.0.0.1=Development access" & set "IP_192.168.1.100=Main workstation" & set "IP_10.0.0.15=Production server"

:: Basic diagnostics
echo.
echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%          Pre-flight Diagnostics          %RESET%
echo %CYAN%===============================================%RESET%
echo %BLUE%^>%RESET% Testing main.py import...
if not exist "main.py" (echo   %RED%[ERROR]%RESET% main.py file not found in current directory) else ("!GLOBAL_VENV_PATH!\Scripts\python.exe" -c "import main; print('  [OK] main.py imported successfully')" & if errorlevel 1 (echo   %RED%[ERROR]%RESET% Could not import main.py - check for syntax errors) else (echo   %GREEN%[OK]%RESET% main.py import verified))
echo.
echo %BLUE%^>%RESET% Testing FastAPI app object...
"!GLOBAL_VENV_PATH!\Scripts\python.exe" -c "import main; app = main.app; print('  [OK] FastAPI app object found')"
if errorlevel 1 (echo   %YELLOW%[WARNING]%RESET% Could not verify FastAPI app object - check main.py has 'app' variable) else (echo   %GREEN%[OK]%RESET% FastAPI app object verified)
echo.
echo %BLUE%^>%RESET% Testing port %BOLD%%YELLOW%8000%RESET% availability...
netstat -an | findstr ":8000 " >nul 2>nul
if errorlevel 1 (echo   %GREEN%[OK]%RESET% Port %BOLD%%YELLOW%8000%RESET% is available) else (echo   %YELLOW%[WARNING]%RESET% Port %BOLD%%YELLOW%8000%RESET% appears to be in use)

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
:: Detect local IP address for network deployment
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address" ^| findstr /v "127.0.0.1"') do (for /f "tokens=1" %%b in ("%%a") do set LOCAL_IP=%%b & goto :ip_found)
:ip_found
if "%LOCAL_IP%"=="" set LOCAL_IP=unknown

echo %CYAN%===============================================%RESET%
echo %BOLD%%GREEN%            SERVER READY               %RESET%
echo %CYAN%===============================================%RESET%
echo.
echo %BOLD%%CYAN%[SERVER LOCATION]%RESET%
echo    Your Machine: %BOLD%%YELLOW%!LOCAL_IP!%RESET%
echo.
echo %BOLD%%CYAN%[ACCESS URLS]%RESET%  
echo    For You:      %BOLD%%GREEN%http://127.0.0.1:8000%RESET%
echo    For Others:   %BOLD%%GREEN%http://!LOCAL_IP!:8000%RESET%
echo.
echo %BOLD%%CYAN%[SHARE WITH EMPLOYEES]%RESET%
echo    Give them: %BOLD%%YELLOW%http://!LOCAL_IP!:8000%RESET%
echo.
echo %BOLD%%CYAN%[SECURITY STATUS]%RESET%
echo    %GREEN%[OK]%RESET% IP Whitelist Active
echo    %GREEN%[OK]%RESET% 127.0.0.1      - %CYAN%!IP_127.0.0.1!%RESET%
echo    %GREEN%[OK]%RESET% 192.168.1.100  - %CYAN%!IP_192.168.1.100!%RESET%
echo    %GREEN%[OK]%RESET% 10.0.0.15      - %CYAN%!IP_10.0.0.15!%RESET%
echo.
echo %BLUE%[INFO] To modify IPs permanently: Edit line 135 in this batch file%RESET%
echo.
set /p modify_ips="%BOLD%%BLUE%Add more IPs for this session? (y/n): %RESET%"

if /i "%modify_ips%"=="y" (
    echo.
    echo %YELLOW%[INFO]%RESET% Add IP addresses with roles - Format: IP_ADDRESS ROLE_DESCRIPTION
    echo %YELLOW%[INFO]%RESET% Example: 192.168.1.50 Manager workstation
    :add_ip_loop
    set /p ip_entry="%BLUE%^>%RESET% IP and Role (or 'done' to finish): "
    if /i "!ip_entry!"=="done" goto :done_adding
    if "!ip_entry!"=="" goto :done_adding
    for /f "tokens=1,*" %%a in ("!ip_entry!") do (set new_ip=%%a & set new_role=%%b)
    if not "!new_ip!"=="" if not "!new_role!"=="" (set ALLOWED_IPS=!ALLOWED_IPS!,!new_ip! & set "IP_!new_ip!=!new_role!" & echo %GREEN%[ADDED]%RESET% !new_ip! - %CYAN%!new_role!%RESET%) else (echo %RED%[ERROR]%RESET% Please provide both IP and role)
    goto :add_ip_loop
    :done_adding
    echo %GREEN%[OK]%RESET% Session IP list updated
)
echo.
echo %BLUE%^>%RESET% Press any key to start the server...
pause >nul

:: Server restart loop
:server_loop
echo.
echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%            Starting Server...            %RESET%
echo %CYAN%===============================================%RESET%
echo.

:: Start server based on deployment type
if "!deployment_type!"=="local" (
    echo %CYAN%===============================================%RESET%
    echo %BOLD%%GREEN%           STARTING SERVER             %RESET%
    echo %CYAN%===============================================%RESET%
    echo.
    echo %BOLD%%BLUE%[LOCAL MODE] - LOCALHOST ONLY%RESET%
    echo    Access: %BOLD%%GREEN%http://127.0.0.1:8000%RESET%
    echo    Press %YELLOW%Ctrl+C%RESET% to stop
    echo.
    echo %CYAN%===========================================%RESET%
    "!GLOBAL_VENV_PATH!\Scripts\python.exe" -m uvicorn main:app --reload
) else (
    echo %CYAN%===============================================%RESET%
    echo %BOLD%%GREEN%           STARTING SERVER             %RESET%
    echo %CYAN%===============================================%RESET%
    echo.
    echo %BOLD%%BLUE%[NETWORK MODE] - REMOTE ACCESS ENABLED%RESET%
    echo    Your Access:     %BOLD%%GREEN%http://127.0.0.1:8000%RESET%
    echo    Employee Access: %BOLD%%GREEN%http://!LOCAL_IP!:8000%RESET%
    echo    Allowed IPs:     %BOLD%%YELLOW%!ALLOWED_IPS!%RESET%
    echo    Press %YELLOW%Ctrl+C%RESET% to stop
    echo.
    echo %CYAN%===========================================%RESET%
    "!GLOBAL_VENV_PATH!\Scripts\python.exe" -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
)

:: Server stopped - offer restart option
echo.
echo %CYAN%===============================================%RESET%
echo %BOLD%%CYAN%            Server Stopped                %RESET%
echo %CYAN%===============================================%RESET%
echo Exit code: %BOLD%%YELLOW%!errorlevel!%RESET%
echo.
echo %BOLD%%GREEN%Quick Restart Options:%RESET%
echo   %YELLOW%Press Enter%RESET% - Restart server (same settings)
echo   %YELLOW%Type 'q' + Enter%RESET% - Quit and close terminal
echo.
set /p restart_choice="%BLUE%^>%RESET% Your choice: "

if /i "!restart_choice!"=="q" (
    echo %GREEN%[OK]%RESET% Goodbye!
    exit /b 0
) else (
    echo %GREEN%[OK]%RESET% Restarting server...
    goto server_loop
)