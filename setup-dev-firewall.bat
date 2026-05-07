@echo off
setlocal EnableExtensions

:: Inbound TCP 5173 (Vite dev / vite preview LAN) and 3000 (optional future API).
:: Run as Administrator once per host PC so phones and other PCs on the same LAN can connect.
:: Same router / subnet = use this PC's IPv4 (Desktop Wi‑Fi or Ethernet does not matter).

:: Usage: setup-dev-firewall.bat           — ends with pause
::        setup-dev-firewall.bat nopause   — no pause (chained from install-dole-spes.bat)

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Right-click this file and choose "Run as administrator".
    if /i not "%~1"=="nopause" pause
    exit /b 1
)

echo Updating Windows Firewall rules for SPES LAN preview...

netsh advfirewall firewall delete rule name="DOLE SPES Dev - Vite 5173" >nul 2>&1
netsh advfirewall firewall delete rule name="DOLE SPES Dev - API 3000" >nul 2>&1

netsh advfirewall firewall add rule name="DOLE SPES Dev - Vite 5173" dir=in action=allow protocol=TCP localport=5173 profile=private,domain
netsh advfirewall firewall add rule name="DOLE SPES Dev - API 3000" dir=in action=allow protocol=TCP localport=3000 profile=private,domain

echo Done. Phones use: http://^<this-PC-LAN-IPv4^>:5173 after `npm run preview:lan` on this PC.
echo The packaged .exe runs locally only; sharing to phones requires preview:lan or a web server on this machine.
echo If Windows marks your network as Public, switch to Private or add rules for the Public profile.

if /i not "%~1"=="nopause" pause
