@echo off
setlocal

cd /d "%~dp0"

if "%~1"=="--check" (
  echo start-mascot.bat OK
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Please install Node.js first: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH.
  echo Please reinstall Node.js with npm enabled.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] package.json was not found.
  echo Please run this BAT from the opencode-mascot project folder.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [INFO] node_modules not found. Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo [INFO] Closing old opencode mascot instance if one is running...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$project = (Resolve-Path -LiteralPath '.').Path; Get-CimInstance Win32_Process -Filter \"name = 'electron.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine -like ('*' + $project + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>nul

echo [INFO] Starting opencode mascot...
call npm start

if errorlevel 1 (
  echo [ERROR] Mascot exited with an error.
  pause
  exit /b 1
)

endlocal
