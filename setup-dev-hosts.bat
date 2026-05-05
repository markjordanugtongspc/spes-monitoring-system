@echo off
:: One-time dev laptop: map dole-spes.local -> 127.0.0.1 (browser on this PC only).
:: Run as Administrator. Skip HR / PM2 production steps.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Right-click this file and choose "Run as administrator".
    pause
    exit /b 1
)

findstr /c:"dole-spes.local" %SystemRoot%\System32\drivers\etc\hosts >nul 2>&1
if %errorLevel% equ 0 (
    echo dole-spes.local is already listed in hosts.
) else (
    echo 127.0.0.1   dole-spes.local>> %SystemRoot%\System32\drivers\etc\hosts
    echo Added: 127.0.0.1   dole-spes.local
)

echo.
echo On this laptop open: http://dole-spes.local:5173
echo On your phone same WiFi use Network URL from Vite , or map dole-spes.local to this PC IP on the phone/router.
pause
