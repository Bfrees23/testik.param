#!/usr/bin/env bash
# Sync canonical JS sources into src/public/js (served by nginx).
# Also mirrors key HTML from public → source pages/ (public is source of truth for HTML).
# Usage:
#   sync-public-js.sh           # sync JS + HTML mirrors
#   sync-public-js.sh --check   # content checksum drift (exit 1)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB="$ROOT/src/public/js"
MODE="${1:-}"

sync_dir() {
  local src="$1"
  local dst="$2"
  local delete_flag="${3:-1}"
  if [[ ! -d "$src" ]]; then
    echo "skip missing: $src"
    return 0
  fi
  mkdir -p "$dst"
  if [[ "$delete_flag" == "1" ]]; then
    rsync -a --delete "$src/" "$dst/"
  else
    rsync -a "$src/" "$dst/"
  fi
  echo "synced: $src -> $dst"
}

check_dir() {
  local src="$1"
  local dst="$2"
  local delete_flag="${3:-1}"
  if [[ ! -d "$src" ]]; then
    return 0
  fi
  mkdir -p "$dst"
  # --checksum: ignore mtime-only / CRLF timestamp noise
  local -a opts=(-a --checksum --dry-run --itemize-changes)
  if [[ "$delete_flag" == "1" ]]; then
    opts+=(--delete)
  fi
  local out
  out=$(rsync "${opts[@]}" "$src/" "$dst/" | grep -E '^[<>c]' || true)
  if [[ -n "$out" ]]; then
    echo "DRIFT: $src -> $dst"
    echo "$out"
    DRIFT=1
  fi
}

sync_html_mirrors() {
  # public HTML is SoT; keep source pages/ copies from reintroducing stale LKG/nav.
  local -a pairs=(
    "$ROOT/src/public/tm07-parametrization-kao.html|$ROOT/src/parametrization/kao/pages/tm07-parametrization-kao.html"
    "$ROOT/src/public/tm07-parametrization-kao-counters.html|$ROOT/src/parametrization/pages/tm07-parametrization-kao-counters.html"
    "$ROOT/src/public/tm07-workbench.html|$ROOT/src/parametrization/pages/tm07-workbench.html"
    "$ROOT/src/public/test-process-m90-15c.html|$ROOT/src/calibration/pages/test-process-m90-15c.html"
  )
  local pair src dst
  for pair in "${pairs[@]}"; do
    src="${pair%%|*}"
    dst="${pair##*|}"
    if [[ ! -f "$src" ]]; then
      continue
    fi
    mkdir -p "$(dirname "$dst")"
    if [[ "$MODE" == "--check" ]]; then
      if ! cmp -s "$src" "$dst" 2>/dev/null; then
        echo "DRIFT HTML: $src != $dst"
        DRIFT=1
      fi
    else
      cp -a "$src" "$dst"
      echo "synced HTML: $src -> $dst"
    fi
  done
}

DRIFT=0

if [[ "$MODE" == "--check" ]]; then
  check_dir "$ROOT/src/parametrization/js" "$PUB/parametrization" 1
  check_dir "$ROOT/src/parametrization/kao/js" "$PUB/parametrization-kao" 1
  check_dir "$ROOT/src/calibration/js" "$PUB/calibration" 1
  check_dir "$ROOT/src/tm07-common/js" "$PUB" 0
  sync_html_mirrors
  if [[ "$DRIFT" -ne 0 ]]; then
    echo "FAIL: run ./scripts/sync-public-js.sh to update public/js and HTML mirrors"
    exit 1
  fi
  echo "OK: public/js and HTML mirrors in sync"
  exit 0
fi

mkdir -p "$PUB"
sync_dir "$ROOT/src/parametrization/js" "$PUB/parametrization" 1
sync_dir "$ROOT/src/parametrization/kao/js" "$PUB/parametrization-kao" 1
sync_dir "$ROOT/src/calibration/js" "$PUB/calibration" 1
# Only overlay common Modbus files — do NOT delete site-*.js in public/js root.
sync_dir "$ROOT/src/tm07-common/js" "$PUB" 0
sync_html_mirrors

echo "OK: public/js mirrors updated (site-*.js preserved); HTML pages/ synced from public"
