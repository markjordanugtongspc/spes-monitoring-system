@echo off
setlocal EnableExtensions
cd /d "%~dp0\.."

:: Electron mode helper (no PM2). Starts latest portable exe if available.
for /f "delims=" %%F in ('dir /b /o:-d "release\DOLE SPES Portal *.exe" 2^>nul ^| findstr /v /i "Setup"') do (
  start "" "release\%%F"
  exit /b 0
)

echo Portable exe not found in release\. Build with install-dole-spes.bat first.
pause
