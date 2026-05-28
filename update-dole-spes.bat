@echo off
setlocal EnableExtensions
cd /d "%~dp0"

:: Usage:
::   update-dole-spes.bat         -> asks patch/minor/major
::   update-dole-spes.bat patch   -> patch bump (0.1.9 -> 0.1.10)
::   update-dole-spes.bat minor   -> minor bump (0.1.9 -> 0.2.0)
::   update-dole-spes.bat major   -> major bump (0.1.9 -> 1.0.0)

set BUMP=%~1
if "%BUMP%"=="" (
  echo.
  set /p BUMP=Select version bump [patch/minor/major] ^(default: patch^): 
  if "%BUMP%"=="" set BUMP=patch
)

where npm >nul 2>&1
if %errorLevel% neq 0 (
  echo npm not found. Install Node.js LTS first.
  pause
  exit /b 1
)

if /i "%BUMP%"=="patch" goto :valid
if /i "%BUMP%"=="minor" goto :valid
if /i "%BUMP%"=="major" goto :valid
echo Invalid bump type: %BUMP%
echo Use patch ^| minor ^| major
pause
exit /b 1

:valid
for /f %%V in ('node -p "require('./package.json').version"') do set CURRENT_VERSION=%%V
echo Current version: %CURRENT_VERSION%

echo Updating dependencies...
call npm install
if %errorLevel% neq 0 (
  echo npm install failed.
  pause
  exit /b 1
)

echo Bumping version (%BUMP%) in package.json + package-lock.json...
call npm run version:%BUMP%
if %errorLevel% neq 0 (
  echo Version bump failed.
  pause
  exit /b 1
)

for /f %%V in ('node -p "require('./package.json').version"') do set NEW_VERSION=%%V
echo New version: %NEW_VERSION%

if not exist "release" mkdir "release"
echo Cleaning old release artifacts...
del /q "release\DOLE SPES Portal*.exe" >nul 2>&1
del /q "release\DOLE SPES Portal*.blockmap" >nul 2>&1

echo Building frontend...
call npm run build
if %errorLevel% neq 0 (
  echo npm run build failed.
  pause
  exit /b 1
)

echo Packaging installer + portable exe...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm run dist
if %errorLevel% neq 0 (
  echo npm run dist failed.
  pause
  exit /b 1
)

echo.
echo Update build done.
echo New files are in release\
echo Version: %NEW_VERSION%
echo Share both: Setup *.exe and portable *.exe
pause
