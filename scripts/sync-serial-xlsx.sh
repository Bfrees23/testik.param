#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DST="$ROOT/data/tmp/nomera_korrektora.xlsx"
mkdir -p "$(dirname "$DST")"
TMP_WIN="C:\\Users\\Public\\nomera_korrektora.xlsx"
SRC='\\\\srv-fs\\FileServer\\Production\\BD_Corrector\\Инструкция по выпуску корректоров\\Номера корректоров.xlsx'
powershell.exe -NoProfile -Command "Copy-Item -LiteralPath '$SRC' -Destination '$TMP_WIN' -Force" >/dev/null
cp -f /mnt/c/Users/Public/nomera_korrektora.xlsx "$DST"
stat -c '%y %s %n' "$DST"
