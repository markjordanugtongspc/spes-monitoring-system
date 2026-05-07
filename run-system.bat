@echo off
setlocal EnableExtensions
cd /d "%~dp0"

:: Electron mode: no PM2. Use a Startup-folder shortcut to spes.exe after packaging,
:: or run `npm run electron` manually after `npm run build`.

exit /b 0
