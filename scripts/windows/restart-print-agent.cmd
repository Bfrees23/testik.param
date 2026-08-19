@echo off
cd /d "%~dp0"
if not exist "%~dp0generated" mkdir "%~dp0generated"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*pdf-print-agent.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
timeout /t 2 /nobreak >nul

start "TM07 Print Agent" /MIN powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pdf-print-agent.ps1" -GeneratedRoot "%~dp0generated"
timeout /t 3 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-RestMethod http://127.0.0.1:18778/health | ConvertTo-Json -Compress } catch { Write-Host ERROR: agent not responding }"
pause
