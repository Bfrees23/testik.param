@echo off
setlocal
REM Установка корневого CA в «Доверенные корневые центры сертификации» Windows.
REM Запускать от имени администратора на каждом рабочем ПК в сети.
cd /d "%~dp0"

set "CA=%~dp0ssl\ca.crt"
if not exist "%CA%" (
  echo Файл не найден: %CA%
  echo Сначала на сервере выполните: docker\nginx\gen-dev-cert.sh
  exit /b 1
)

echo Установка CA: %CA%
certutil -addstore -f Root "%CA%"
if errorlevel 1 (
  echo.
  echo Ошибка. Запустите этот файл от имени администратора.
  exit /b 1
)

echo.
echo Готово. Перезапустите Chrome/Edge и откройте https://IP-СЕРВЕРА:8443
echo Замок в адресной строке должен быть «Защищено» без предупреждений.
pause
