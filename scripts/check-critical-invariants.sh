#!/usr/bin/env bash
# Static guards for production-critical parametrization logic (no browser).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/selenium-bot"
python3 - <<'PY'
from checks.critical_source_checks import run_critical_source_checks
for name in run_critical_source_checks():
    print("OK:", name)
print("critical invariants OK")
PY
