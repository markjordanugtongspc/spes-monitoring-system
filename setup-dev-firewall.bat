@echo off
:: Opens inbound TCP 5173 (Vite) and 3000 (Express API) on Private networks.
:: Run as Administrator once per PC so phones on the same LAN can connect during dev.
:: Safe to run multiple times (rules are recreated).

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Right-click this file and choose "Run as administrator".
    pause
    exit /b 1
)

echo Updating Windows Firewall rules for SPES dev...

netsh advfirewall firewall delete rule name="DOLE SPES Dev - Vite 5173" >nul 2>&1
netsh advfirewall firewall delete rule name="DOLE SPES Dev - API 3000" >nul 2>&1

netsh advfirewall firewall add rule name="DOLE SPES Dev - Vite 5173" dir=in action=allow protocol=TCP localport=5173 profile=private
netsh advfirewall firewall add rule name="DOLE SPES Dev - API 3000" dir=in action=allow protocol=TCP localport=3000 profile=private

echo Done. Rules apply to Private profile only (typical home/office Wi-Fi).
echo If your PC Wi-Fi is set to Public, switch it to Private or add rules for Public profile.
pause
