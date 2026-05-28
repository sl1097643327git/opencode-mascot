@echo off
setlocal

cd /d "%~dp0"

if "%~1"=="--check" (
  echo uninstall-opencode-plugin.bat OK
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

echo [INFO] Uninstalling opencode mascot plugin...
node scripts\uninstall-opencode-plugin.js
if errorlevel 1 (
  echo [ERROR] Plugin uninstall failed.
  pause
  exit /b 1
)

echo.
echo [OK] opencode mascot plugin uninstalled.
echo [INFO] mascot.json user settings were preserved.
echo [INFO] Restart opencode to stop loading the plugin.
pause

endlocal
