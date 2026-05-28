@echo off
setlocal EnableExtensions
cd /d "%~dp0"

:: Full setup (Administrator): deps, build, Windows installer + portable .exe, firewall + hosts for LAN preview.
:: The .exe is per-computer (Electron loads files locally). For phones on Wi‑Fi, run `npm run preview:lan`
:: on this PC after build — same LAN devices open http://<this-PC-IPv4>:5173

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

where npm >nul 2>&1
if %errorLevel% neq 0 (
    echo npm not found. Install Node.js LTS, then re-run this script.
    pause
    exit /b 1
)

call "%~dp0kill-dev-ports.bat" nopause

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

echo Packaging Electron ^(NSIS installer + portable .exe in release\^)...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm run dist
if %errorLevel% neq 0 (
    echo electron-builder failed.
    pause
    exit /b 1
)

call "%~dp0installers\setup-dev-firewall.bat" nopause
if %errorLevel% neq 0 (
    echo Firewall step failed.
    pause
    exit /b 1
)

call "%~dp0installers\setup-dev-hosts.bat" nopause

echo.
echo Build output: see folder release\
echo   - DOLE SPES Portal Setup *.exe   ^(installer^)
echo   - DOLE SPES Portal *portable*.exe   ^(no install^)
echo.
echo LAN phones/other PCs: run installers\run-lan-preview.bat on THIS machine, then open http://^<this-IPv4^>:5173 from them.
echo Desktop wired + laptop Wi-Fi on same router still share the same LAN; use the hosting PC's IPv4 address.
pause
