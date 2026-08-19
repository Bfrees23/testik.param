#!/bin/bash
# Одноразовая установка схемы TM07 (docker compose service firebird-init).
# Идемпотентно: если таблицы уже есть — exit 0 (не валит php при recreate).
set -euo pipefail

FB="/usr/local/firebird/bin/isql"
DB="/firebird/data/${FIREBIRD_DATABASE:-tm07_bench.fdb}"
PASS="${ISC_PASSWORD:-masterkey}"
SCHEMA="${SCHEMA_PATH:-/schema/schema.firebird.sql}"
# Каталог PHP (db_bench.php) сидит 15 типов — schema SQL тоже 15.
MIN_EVENT_TYPES="${MIN_EVENT_TYPES:-11}"

event_type_count() {
  echo "SELECT COUNT(*) FROM TM07_EVENT_TYPE;" | "$FB" -user sysdba -password "$PASS" "$DB" 2>/dev/null \
    | awk '/^[[:space:]]*[0-9]+[[:space:]]*$/ {print $1; exit}'
}

table_exists() {
  local t="$1"
  echo "SELECT 1 FROM RDB\$RELATIONS WHERE RDB\$RELATION_NAME = '${t}';" \
    | "$FB" -user sysdba -password "$PASS" "$DB" 2>/dev/null | grep -q 1
}

schema_ready() {
  if ! table_exists 'TM07_EVENT_TYPE'; then
    return 1
  fi
  if ! table_exists 'TM07_BENCH_SESSION'; then
    return 1
  fi
  if ! table_exists 'TM07_OPERATOR'; then
    return 1
  fi
  local n
  n="$(event_type_count || true)"
  if [[ -n "${n}" && "${n}" -ge "${MIN_EVENT_TYPES}" ]]; then
    return 0
  fi
  return 1
}

echo "[tm07-init] Waiting for ${DB}..."
for _ in $(seq 1 90); do
  if echo "SELECT 1 FROM RDB\$DATABASE;" | "$FB" -user sysdba -password "$PASS" "$DB" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
sleep 2

if schema_ready; then
  n="$(event_type_count || echo '?')"
  echo "[tm07-init] Schema already present (EVENT_TYPES=${n}). OK."
  exit 0
fi

echo "[tm07-init] Applying ${SCHEMA}..."
apply_ok=0
for attempt in 1 2 3; do
  if "$FB" -user sysdba -password "$PASS" "$DB" -i "$SCHEMA"; then
    apply_ok=1
    break
  fi
  echo "[tm07-init] Attempt ${attempt} failed (possibly already exists), retry in 5s..."
  sleep 5
  if schema_ready; then
    apply_ok=1
    break
  fi
done

if schema_ready; then
  n="$(event_type_count || echo '?')"
  echo "[tm07-init] Done. EVENT_TYPES=${n}"
  exit 0
fi

echo "[tm07-init] ERROR: schema incomplete after apply (ok=${apply_ok})."
echo "[tm07-init] Reset only if intentionally wiping DB: docker volume rm tm07-bench_firebird_data"
exit 1
