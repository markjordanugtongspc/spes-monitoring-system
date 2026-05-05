@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where pm2 >nul 2>&1
if %errorLevel% neq 0 exit /b 0

:: After reboot: restore saved PM2 apps; if none, start the server once.
call pm2 resurrect >nul 2>&1
if %errorLevel% neq 0 (
    call pm2 start src/backend/server.js --name dole-spes --cwd "%CD%"
)
exit /b 0
