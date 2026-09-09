#!/usr/bin/env bash
# Локальный CA + серверный сертификат для HTTPS (Web Serial по LAN).
#
# 1) На сервере:  ./docker/nginx/gen-dev-cert.sh [доп. IP ...]
# 2) На каждом ПК: docker/nginx/install-root-ca-windows.cmd  (или install-root-ca-linux.sh)
# 3) docker compose up -d nginx
#
# Опционально: если установлен mkcert — используется он (проще на dev-машине).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSL_DIR="${DIR}/ssl"
CRT="${SSL_DIR}/prod.crt"
KEY="${SSL_DIR}/prod.key"
CA_KEY="${SSL_DIR}/ca.key"
CA_CRT="${SSL_DIR}/ca.crt"

mkdir -p "${SSL_DIR}"

# Ethernet/Wi-Fi хоста Windows (не vEthernet WSL — у него в имени тоже бывает «Ethernet»).
HOST_IP="$(powershell.exe -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.IPAddress -notmatch '^(127\.|169\.254\.)' -and \$_.InterfaceAlias -notmatch 'Loopback|WSL|vEthernet|Hyper-V|Docker' -and (\$_.InterfaceAlias -eq 'Ethernet' -or \$_.InterfaceAlias -match '^(Wi-Fi|WLAN|Ethernet )') } | Select-Object -First 1 -ExpandProperty IPAddress)" 2>/dev/null | tr -d '\r' || true)"
if [[ -z "${HOST_IP}" ]]; then
  HOST_IP="$(powershell.exe -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.IPAddress -notmatch '^(127\.|169\.254\.)' -and \$_.InterfaceAlias -notmatch 'Loopback|WSL|vEthernet|Hyper-V|Docker' } | Select-Object -First 1 -ExpandProperty IPAddress)" 2>/dev/null | tr -d '\r' || true)"
fi
WSL_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"

EXTRA=("$@")
NAMES=(localhost bench tm07-bench)
IPS=(127.0.0.1 ::1)

add_ip() {
  local ip="$1"
  [[ -n "${ip}" ]] || return 0
  local found=0
  for x in "${IPS[@]}"; do [[ "${x}" == "${ip}" ]] && found=1; done
  if [[ "${found}" -eq 0 ]]; then
    IPS+=("${ip}")
  fi
  return 0
}

add_ip "${HOST_IP}"
add_ip "${WSL_IP}"
for x in "${EXTRA[@]}"; do add_ip "${x}"; done

if command -v mkcert >/dev/null 2>&1; then
  echo "mkcert найден — выпускаем доверенный сертификат…"
  MKCERT_ARGS=()
  for n in "${NAMES[@]}"; do MKCERT_ARGS+=("${n}"); done
  for ip in "${IPS[@]}"; do MKCERT_ARGS+=("${ip}"); done
  (
    cd "${SSL_DIR}"
    mkcert -install 2>/dev/null || true
    mkcert -key-file prod.key -cert-file prod.crt "${MKCERT_ARGS[@]}"
    if [[ -f "$(mkcert -CAROOT)/rootCA.pem" ]]; then
      cp "$(mkcert -CAROOT)/rootCA.pem" "${CA_CRT}"
      echo "Корневой CA mkcert: ${CA_CRT}"
    fi
  )
  chmod 600 "${KEY}" 2>/dev/null || true
  if [[ -f "${CRT}" && -f "${CA_CRT}" ]]; then
    cat "${CRT}" "${CA_CRT}" > "${SSL_DIR}/fullchain.crt"
  elif [[ -f "${CRT}" ]]; then
    cp "${CRT}" "${SSL_DIR}/fullchain.crt"
  fi
  echo "Сертификат: ${CRT}"
  echo "SAN: ${NAMES[*]} ${IPS[*]}"
  echo ""
  echo "На других ПК установите CA: docker/nginx/install-root-ca-windows.cmd"
  exit 0
fi

echo "mkcert не найден — создаём локальный CA (OpenSSL)…"

if [[ ! -f "${CA_KEY}" || ! -f "${CA_CRT}" ]]; then
  openssl genrsa -out "${CA_KEY}" 4096
  openssl req -x509 -new -nodes -key "${CA_KEY}" -sha256 -days 3650 \
    -out "${CA_CRT}" \
    -subj "/CN=TM07-Bench Local CA/O=Elemer-KT/C=RU"
  chmod 600 "${CA_KEY}"
  echo "Создан корневой CA: ${CA_CRT}"
fi

SAN=""
for n in "${NAMES[@]}"; do
  [[ -n "${SAN}" ]] && SAN+=","
  SAN+="DNS:${n}"
done
for ip in "${IPS[@]}"; do
  SAN+=",IP:${ip}"
done

CSR="${SSL_DIR}/server.csr"
EXT="${SSL_DIR}/server.ext"
SERIAL="${SSL_DIR}/ca.srl"

openssl genrsa -out "${KEY}" 2048
openssl req -new -key "${KEY}" -out "${CSR}" \
  -subj "/CN=bench-prod/O=Elemer-KT/C=RU"

cat > "${EXT}" <<EOF
subjectAltName=${SAN}
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
EOF

openssl x509 -req -in "${CSR}" -CA "${CA_CRT}" -CAkey "${CA_KEY}" \
  -CAcreateserial -out "${CRT}" -days 825 -sha256 \
  -extfile "${EXT}"

chmod 600 "${KEY}" "${CA_KEY}"
rm -f "${CSR}" "${EXT}"

# nginx слушает fullchain.crt + prod.key — без обновления fullchain будет key mismatch.
cat "${CRT}" "${CA_CRT}" > "${SSL_DIR}/fullchain.crt"

echo "Серверный сертификат: ${CRT}"
echo "SAN: ${SAN}"
echo ""
echo "Чтобы браузер показывал «Защищено» без предупреждений:"
echo "  Windows: docker\\\\nginx\\\\install-root-ca-windows.cmd"
echo "  Linux:   sudo docker/nginx/install-root-ca-linux.sh"
