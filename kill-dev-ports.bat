@echo off
setlocal EnableExtensions

:: Free TCP 5173 (Vite / preview:lan) and 3000 (optional API) if a session left Node listening.
:: Usage: kill-dev-ports.bat           — ends with pause
::        kill-dev-ports.bat nopause   — no pause (for chaining from install-dole-spes.bat)

echo Freeing ports 5173 and 3000 (LISTENING processes)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = @(5173, 3000); foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('Stopping PID ' + $_.OwningProcess + ' on port ' + $port); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"
echo Done.

if /i not "%~1"=="nopause" (
  echo Run: npm run dev   or   npm run preview:lan
  pause
)
