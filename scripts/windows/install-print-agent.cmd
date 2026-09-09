@echo off
setlocal
cd /d "%~dp0"

echo === Install TM-07 print agent (workstation) ===
if not exist "C:\tm07-agent" mkdir "C:\tm07-agent"
if not exist "C:\tm07-agent\generated" mkdir "C:\tm07-agent\generated"

copy /Y "%~dp0pdf-print-agent.ps1" "C:\tm07-agent\" >nul
copy /Y "%~dp0pdf-print-agent.cmd" "C:\tm07-agent\" >nul
copy /Y "%~dp0restart-print-agent.cmd" "C:\tm07-agent\" >nul
copy /Y "%~dp0start-pdf-print-agent.cmd" "C:\tm07-agent\" >nul
copy /Y "%~dp0start-print-agent-silent.cmd" "C:\tm07-agent\" >nul

REM Autostart on Windows logon (Startup folder)
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%STARTUP%\TM07-Print-Agent.lnk'); $s.TargetPath = 'C:\tm07-agent\start-print-agent-silent.cmd'; $s.WorkingDirectory = 'C:\tm07-agent'; $s.WindowStyle = 7; $s.Save()"

echo Installed to C:\tm07-agent
echo Startup shortcut: TM07-Print-Agent.lnk
echo.

echo Starting agent now...
call "C:\tm07-agent\start-print-agent-silent.cmd"

timeout /t 2 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $h = Invoke-RestMethod http://127.0.0.1:18778/health; Write-Host ('OK agent v' + $h.version + ' printer=' + $h.printer) } catch { Write-Host 'WARN: agent not responding yet — run C:\tm07-agent\restart-print-agent.cmd' }"

echo.
echo Check: http://127.0.0.1:18778/health
echo Bench print uses HTML -^> PNG -^> TSPL to this agent.
echo.
pause
