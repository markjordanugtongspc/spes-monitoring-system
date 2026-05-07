@echo off
setlocal EnableExtensions
cd /d "%~dp0"

:: One-time HR / production PC setup: hosts, firewall, deps, build (Electron desktop).
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

:: Hosts (optional local name — Electron loads file:// dist; keep if you still want a name)
findstr /c:"dole-spes.local" %SystemRoot%\System32\drivers\etc\hosts >nul 2>&1
if %errorLevel% equ 0 (
    echo Hosts: dole-spes.local already present.
) else (
    echo 127.0.0.1   dole-spes.local>> %SystemRoot%\System32\drivers\etc\hosts
    echo Hosts: added 127.0.0.1 dole-spes.local
)

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

echo Building frontend ^(dist/^ for Electron^)...
call npm run build
if %errorLevel% neq 0 (
    echo npm run build failed.
    pause
    exit /b 1
)

echo.
echo Done. Launch the desktop app: npm run electron
echo Or from npm scripts in your IDE: electron ^(after build^).
echo Optional: packaging to .exe can be added later ^(e.g. electron-builder^).
pause
