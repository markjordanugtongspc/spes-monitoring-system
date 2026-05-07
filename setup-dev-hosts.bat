@echo off
setlocal EnableExtensions

:: Map dole-spes.local -^> 127.0.0.1 on this PC only (browser shortcuts).
:: Usage: setup-dev-hosts.bat           — ends with pause
::        setup-dev-hosts.bat nopause   — no pause

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Right-click this file and choose "Run as administrator".
    if /i not "%~1"=="nopause" pause
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
echo On this PC: http://dole-spes.local:5173 ^(with npm run dev or npm run preview:lan^).
echo Other devices on LAN use http://^<this-PC-IPv4^>:5173 — not dole-spes.local unless you configure DNS/hosts per device.

if /i not "%~1"=="nopause" pause
