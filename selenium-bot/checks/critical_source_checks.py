"""Static checks for critical parametrization invariants (no Selenium)."""

from __future__ import annotations

import re
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def check_verify_snapshot_before_read(workbench_js: str) -> None:
    m = re.search(
        r"async function verifyDeviceAgainstOrderAfterWrite\(\)\s*\{(?P<body>.*?)\n    async function ",
        workbench_js,
        re.S,
    )
    assert m, "verifyDeviceAgainstOrderAfterWrite not found"
    body = m.group("body")
    i_exp = body.find("collectExpectedFieldSnapshot")
    i_read = body.find("readAllSections")
    assert i_exp >= 0 and i_read >= 0, "expected snapshot/read calls missing"
    assert i_exp < i_read, "expected snapshot must be taken before readAllSections"


def check_write_disconnect_throws(kao_js: str) -> None:
    m = re.search(r"writeAllSections:\s*async function\s*\([^)]*\)\s*\{(?P<head>.{0,500})", kao_js, re.S)
    assert m, "writeAllSections not found"
    head = m.group("head")
    assert re.search(r"if\s*\(\s*!isKaoConnected\(\)\s*\)\s*\{\s*throw new Error", head), (
        "writeAllSections must throw when KAO disconnected"
    )
    assert not re.search(r"if\s*\(\s*!isKaoConnected\(\)\s*\)\s*return\s*;", head), (
        "writeAllSections must not silently return on disconnect"
    )


def check_no_hardcoded_lkg(root: Path) -> None:
    needle = "AD 9E A9 C0"
    roots = [
        root / "src/public",
        root / "src/parametrization",
        root / "src/calibration",
    ]
    hits = []
    for base in roots:
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in {".js", ".html", ".php", ".txt", ".md"}:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if needle in text:
                hits.append(str(path.relative_to(root)))
    assert not hits, "hardcoded LKG in: " + ", ".join(hits)


def run_critical_source_checks() -> list[str]:
    root = _repo_root()
    wb = (root / "src/parametrization/js/tm07-workbench.js").read_text(encoding="utf-8")
    kao = (root / "src/parametrization/kao/js/tm07-parametrization-kao.js").read_text(encoding="utf-8")
    check_verify_snapshot_before_read(wb)
    check_write_disconnect_throws(kao)
    check_no_hardcoded_lkg(root)
    assert "writeResult.ok" in wb, "workbench must check writeResult.ok"
    assert re.search(r"if\s*\(\s*resume\s*\)\s*\{\s*mainAlready\s*=", kao), (
        "mainAlready skip must be gated by resume"
    )
    return [
        "verify snapshot before read",
        "writeAllSections throws on disconnect",
        "no hardcoded LKG",
        "writeResult.ok checked",
        "fingerprint skip gated by resume",
    ]


def register(bot) -> None:
    """Optional hook if bot auto-discovers check modules with register()."""

    def _run() -> None:
        names = run_critical_source_checks()
        for n in names:
            bot.ok(f"critical: {n}")

    if hasattr(bot, "add_check"):
        bot.add_check("critical_source", _run)
