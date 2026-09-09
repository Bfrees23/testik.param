@echo off
REM Silent start for Startup folder / install � no pause
setlocal
cd /d "%~dp0"

REM Stop previous agent instances (same script)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*pdf-print-agent.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 1 /nobreak >nul

if not exist "%~dp0generated" mkdir "%~dp0generated"

start "TM07 Print Agent" /MIN powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pdf-print-agent.ps1" -GeneratedRoot "%~dp0generated"
exit /b 0
