@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo Serving ./dist on LAN — http://0.0.0.0:5173
echo Phones/other PCs: use this machine IPv4, e.g. http://192.168.x.x:5173
echo Requires: npm run build first. Run setup-dev-firewall.bat as Admin once if blocked.

call npm run preview:lan
pause
