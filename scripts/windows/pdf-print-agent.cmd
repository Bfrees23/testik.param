@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pdf-print-agent.ps1" %*
if errorlevel 1 pause
