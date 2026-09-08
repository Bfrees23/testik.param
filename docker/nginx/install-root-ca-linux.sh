#!/usr/bin/env bash
# Установка корневого CA в хранилище доверия Linux (WSL / Ubuntu).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CA="${DIR}/ssl/ca.crt"

if [[ ! -f "${CA}" ]]; then
  echo "Файл не найден: ${CA}" >&2
  echo "Сначала выполните: ${DIR}/gen-dev-cert.sh" >&2
  exit 1
fi

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "Запустите с sudo: sudo $0" >&2
  exit 1
fi

if command -v update-ca-certificates >/dev/null 2>&1; then
  cp "${CA}" /usr/local/share/ca-certificates/tm07-bench-ca.crt
  update-ca-certificates
  echo "CA установлен (update-ca-certificates)."
elif command -v trust >/dev/null 2>&1; then
  cp "${CA}" /etc/pki/ca-trust/source/anchors/tm07-bench-ca.crt
  trust extract-compat
  echo "CA установлен (trust)."
else
  echo "Не найден update-ca-certificates или trust." >&2
  exit 1
fi

echo "Перезапустите браузер и откройте https://IP-СЕРВЕРА:8443"
