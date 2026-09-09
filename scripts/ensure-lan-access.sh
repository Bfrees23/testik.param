#!/usr/bin/env bash
# Проверка LAN-доступа стенда + обновление сертификата под текущий Ethernet IP.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Не брать vEthernet/WSL: alias «vEthernet (WSL…)» содержит слово Ethernet.
LAN_IP="$(powershell.exe -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.IPAddress -notmatch '^(127\.|169\.254\.)' -and \$_.InterfaceAlias -notmatch 'Loopback|WSL|vEthernet|Hyper-V|Docker' -and (\$_.InterfaceAlias -eq 'Ethernet' -or \$_.InterfaceAlias -match '^(Wi-Fi|WLAN|Ethernet )') } | Select-Object -First 1 -ExpandProperty IPAddress)" 2>/dev/null | tr -d '\r' || true)"
if [[ -z "${LAN_IP}" ]]; then
  LAN_IP="$(powershell.exe -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.IPAddress -notlike '127.*' -and \$_.InterfaceAlias -notmatch 'Loopback|WSL|vEthernet|Hyper-V|Docker' } | Select-Object -First 1 -ExpandProperty IPAddress)" 2>/dev/null | tr -d '\r' || true)"
fi

echo "LAN IP: ${LAN_IP:-?}"
echo "URL:    https://${LAN_IP}:8443"
echo "CA:     https://${LAN_IP}:8443/bench-ca.crt"
echo ""

if [[ -n "${LAN_IP}" ]]; then
  echo "Обновляю HTTPS-сертификат (SAN + ${LAN_IP})..."
  ./docker/nginx/gen-dev-cert.sh "${LAN_IP}" || true
fi

echo "Перезапуск nginx..."
docker compose up -d --no-deps nginx
sleep 2

echo "Проверка API..."
CODE="$(curl -sk -o /tmp/tm07-lan-status.json -w '%{http_code}' --connect-timeout 5 "https://${LAN_IP}:8443/api/bench-db-status.php?action=status" || true)"
echo "HTTP ${CODE}"
head -c 300 /tmp/tm07-lan-status.json 2>/dev/null || true
echo ""
echo ""
echo "С других ПК в LAN: https://${LAN_IP}:8443"
echo "Проброс на публичный IP не нужен. Wi‑Fi: та же сеть, что Ethernet, либо USB Wi‑Fi + хот‑спот Windows."
echo "Firewall Hyper-V (если нужно): powershell -File scripts/ensure-lan-access.ps1"
