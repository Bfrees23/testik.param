@echo off
REM TM-07 Senselock workstation agent (127.0.0.1:18779)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Unblock-File -LiteralPath '%~dp0senselock-workstation-agent.ps1' -ErrorAction SilentlyContinue; & '%~dp0senselock-workstation-agent.ps1' @args" %*
if errorlevel 1 pause
