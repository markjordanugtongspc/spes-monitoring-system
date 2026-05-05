@echo off
setlocal EnableExtensions
cd /d "%~dp0"

:: One-time HR / production PC setup: hosts, firewall, deps, build, PM2.
:: Run as Administrator from the folder where this repo lives (any path — not hardcoded).

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Run this script as Administrator.
    pause
    exit /b 1
)

echo Project folder: %CD%

if not exist "src\backend\.env" (
    if exist "src\backend\.env.example" (
        copy /Y "src\backend\.env.example" "src\backend\.env" >nul
        echo Created src\backend\.env from .env.example
    ) else (
        echo WARNING: No src\backend\.env.example - create src\backend\.env manually.
    )
)

:: Hosts (idempotent)
findstr /c:"dole-spes.local" %SystemRoot%\System32\drivers\etc\hosts >nul 2>&1
if %errorLevel% equ 0 (
    echo Hosts: dole-spes.local already present.
) else (
    echo 127.0.0.1   dole-spes.local>> %SystemRoot%\System32\drivers\etc\hosts
    echo Hosts: added 127.0.0.1 dole-spes.local
)

:: Firewall — inbound API + static (default PORT 3000; match src/backend/.env if you change it)
set SPES_PORT=3000
netsh advfirewall firewall delete rule name="DOLE SPES Production - App 3000" >nul 2>&1
netsh advfirewall firewall add rule name="DOLE SPES Production - App 3000" dir=in action=allow protocol=TCP localport=%SPES_PORT% profile=domain,private,public
echo Firewall: allowed inbound TCP %SPES_PORT% ^(domain, private, public profiles^).

where npm >nul 2>&1
if %errorLevel% neq 0 (
    echo npm not found. Install Node.js LTS, then re-run this script.
    pause
    exit /b 1
)

echo Installing dependencies...
call npm install
if %errorLevel% neq 0 (
    echo npm install failed.
    pause
    exit /b 1
)

echo Building frontend...
call npm run build
if %errorLevel% neq 0 (
    echo npm run build failed.
    pause
    exit /b 1
)

npm list -g pm2 >nul 2>&1
if %errorLevel% neq 0 (
    echo Installing PM2 globally...
    call npm install -g pm2
)

call pm2 delete dole-spes >nul 2>&1
echo Starting server with PM2...
call pm2 start src/backend/server.js --name dole-spes --cwd "%CD%"
call pm2 save
echo Configuring PM2 to start on boot ^(may print a one-time command to run as Admin^)...
call pm2 startup windows --yes

echo.
echo Done. On this PC open: http://dole-spes.local:%SPES_PORT%/
echo Students ^(QR / poster^): http://^<this-PC-LAN-IP^>:%SPES_PORT%/
echo Optional DNS: dole-spes.local -^> this PC LAN IP ^(not required if using IP + QR^).
pause
