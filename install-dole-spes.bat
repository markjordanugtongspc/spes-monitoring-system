@echo off
:: Ensure script runs as Administrator
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Running with Administrator rights...
) else (
    echo This script must be run as Administrator!
    pause
    exit
)

:: Step 1: Add local domain to hosts file
echo 127.0.0.1   dole-spes.local >> %SystemRoot%\System32\drivers\etc\hosts
echo Added local domain mapping: http://dole-spes.local

:: Step 2: Install PM2 globally if not installed
npm list -g pm2 >nul 2>&1
if %errorLevel% neq 0 (
    echo Installing PM2 globally...
    npm install -g pm2
) else (
    echo PM2 already installed.
)

:: Step 3: Navigate to project folder
cd C:\dole-spes

:: Step 4: Start server with PM2
pm2 start server.js --name "dole-spes"

:: Step 5: Save PM2 process list
pm2 save

:: Step 6: Configure PM2 to auto-start on boot
pm2 startup windows --yes

echo Installation complete!
echo DOLE SPES Attendance System will now auto-start on every boot.
pause
