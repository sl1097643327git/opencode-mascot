@echo off
setlocal

cd /d "%~dp0"

if "%~1"=="--check" (
  echo install-opencode-plugin.bat OK
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Please install Node.js first: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] package.json was not found.
  echo Please run this BAT from the desktop mascot project folder.
  pause
  exit /b 1
)

echo [INFO] Installing opencode mascot plugin...
node scripts\install-opencode-plugin.js
if errorlevel 1 (
  echo [ERROR] Plugin installation failed.
  pause
  exit /b 1
)

echo.
echo [OK] opencode mascot plugin installed.
echo [INFO] Restart opencode or load the plugin from your opencode config.
pause

endlocal
