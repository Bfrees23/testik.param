@echo off
chcp 65001 >nul
setlocal EnableExtensions

REM ============================================================
REM  Install temporary BPK layer into tm07_bench.fdb (via isql)
REM  Bypasses IBExpert fbclient.dll / firebird.msg issues.
REM ============================================================

set "ISQL=C:\Program Files\Firebird\Firebird_3_0\isql.exe"
set "DB=localhost:C:\Firebird\tm07_bench.fdb"
set "USER=SYSDBA"
set "PASS=masterkey"

if not exist "%ISQL%" (
    echo [ERROR] isql.exe not found:
    echo   %ISQL%
    echo Edit ISQL path in database\install_bpek_bench.cmd
    exit /b 1
)

cd /d "%~dp0"

echo.
echo === 1/2 Schema (generators + BPK tables) ===
"%ISQL%" -user %USER% -password %PASS% %DB% -i bpek_tm07_bench_schema.ibexpert.sql
if errorlevel 1 (
    echo.
    echo [ERROR] Schema failed.
    echo If objects already exist, that is OK for step 1 — continue or run drop first:
    echo   "%ISQL%" -user %USER% -password %PASS% %DB% -i bpek_tm07_bench_drop.ibexpert.sql
    exit /b 1
)

echo.
echo === 2/2 Seed (types 37/38 + TM-07 events) ===
"%ISQL%" -user %USER% -password %PASS% %DB% -i bpek_tm07_prepare_tm07_bench.ibexpert.sql
if errorlevel 1 (
    echo [ERROR] Prepare/seed failed.
    exit /b 1
)

echo.
echo === Verify ===
"%ISQL%" -user %USER% -password %PASS% %DB% -q "SELECT ID, NAME, PREFIX_NEW FROM BPKTYPEDICT WHERE ID IN (37,38);"
"%ISQL%" -user %USER% -password %PASS% %DB% -q "SELECT COUNT(*) AS TM07_EVENT_TYPES FROM BPKEVENTTYPEDICT WHERE NAME STARTING WITH 'ТМ-07:';"

echo.
echo Done. Expect types 37/38 and TM07_EVENT_TYPES = 8
exit /b 0
