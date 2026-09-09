"""Pytest-обёртка над run_bot (опционально)."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_smoke_suite():
    proc = subprocess.run(
        [sys.executable, str(ROOT / "run_bot.py")],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
