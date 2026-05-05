@echo off
:: Free TCP 5173 (Vite) and 3000 (Express) if an old dev session left Node listening.
:: Close terminals running npm run dev first when possible; use this when ports stay stuck.

echo Freeing ports 5173 and 3000 (LISTENING Node processes)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = @(5173, 3000); foreach ($port in $ports) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('Stopping PID ' + $_.OwningProcess + ' on port ' + $port); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"
echo Done. Run: npm run dev
pause
