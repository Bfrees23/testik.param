#!/usr/bin/env bash
# Тянет / пушит «Номера корректоров.xlsx» с шары srv-fs в локальную копию для Docker PHP.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DST="$ROOT/data/serial/Номера корректоров.xlsx"
mkdir -p "$(dirname "$DST")"

SRC='\\srv-fs\FileServer\Production\BD_Corrector\Инструкция по выпуску корректоров\Номера корректоров.xlsx'
TMP_WIN='C:\Users\Public\nomera_korrektora.xlsx'
TMP_LINUX='/mnt/c/Users/Public/nomera_korrektora.xlsx'
MODE="${1:-pull}"

pull() {
  powershell.exe -NoProfile -Command \
    "Copy-Item -LiteralPath '$SRC' -Destination '$TMP_WIN' -Force" >/dev/null
  cp -f "$TMP_LINUX" "$DST"
  # запасная копия для firmware/
  mkdir -p "$ROOT/firmware"
  cp -f "$DST" "$ROOT/firmware/Номера корректоров.xlsx"
  rm -f "$(dirname "$DST")/.need_push"
  stat -c '%y %s %n' "$DST"
  echo "OK pull <- $SRC"
}

push() {
  if [[ ! -f "$DST" ]]; then
    echo "нет локального файла: $DST" >&2
    exit 1
  fi
  cp -f "$DST" "$TMP_LINUX"
  powershell.exe -NoProfile -Command \
    "Copy-Item -LiteralPath '$TMP_WIN' -Destination '$SRC' -Force" >/dev/null
  rm -f "$(dirname "$DST")/.need_push"
  echo "OK push -> $SRC"
  stat -c '%y %s %n' "$DST"
}

case "$MODE" in
  pull) pull ;;
  push) push ;;
  sync)
    if [[ -f "$(dirname "$DST")/.need_push" ]]; then
      push
    else
      pull
    fi
    ;;
  *)
    echo "usage: $0 [pull|push|sync]" >&2
    exit 2
    ;;
esac
