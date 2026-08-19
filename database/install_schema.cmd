@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM ============================================================
REM  Install TM07 schema into Firebird 3.0 (bypasses IBExpert)
REM  Edit paths below if your Firebird is installed elsewhere.
REM ============================================================

set "ISQL=C:\Program Files\Firebird\Firebird_3_0\isql.exe"
set "DB=localhost:C:\Firebird\tm07_bench.fdb"
set "USER=SYSDBA"
set "PASS=masterkey"

if not exist "%ISQL%" (
    echo [ERROR] isql.exe not found:
    echo   %ISQL%
    echo Edit ISQL path in database\install_schema.cmd
    exit /b 1
)

if not exist "C:\Firebird" mkdir "C:\Firebird"

cd /d "%~dp0"

echo.
echo === Test connection ===
"%ISQL%" -user %USER% -password %PASS% %DB% -i test_connection.sql
if errorlevel 1 (
    echo.
    echo [ERROR] Cannot connect or DB missing.
    echo Create database first in IBExpert:
    echo   Database - Create Database - C:\Firebird\tm07_bench.fdb
    echo   SQL Dialect 3, Charset UTF8
    exit /b 1
)

echo.
echo === Drop old TM07 objects (ignore errors if empty) ===
"%ISQL%" -user %USER% -password %PASS% %DB% -i drop_tm07_tables.sql 2>nul

echo.
echo === Install schema ===
"%ISQL%" -user %USER% -password %PASS% %DB% -i schema.firebird.sql
if errorlevel 1 (
    echo [ERROR] Schema install failed.
    exit /b 1
)

echo.
echo === Verify ===
"%ISQL%" -user %USER% -password %PASS% %DB% -q "SELECT COUNT(*) AS EVENT_TYPES FROM TM07_EVENT_TYPE;"

echo.
echo Done. Expected EVENT_TYPES = 7
exit /b 0
