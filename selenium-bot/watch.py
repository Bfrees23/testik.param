# Visual watch mode: pauses, highlights, keep browser open.
from __future__ import annotations

import time

import config

_enabled = False


def enable() -> None:
    global _enabled
    _enabled = True
    config.HEADLESS = False


def is_enabled() -> bool:
    return _enabled


def step(title: str, detail: str = "") -> None:
    if not (_enabled or config.VERBOSE):
        return
    line = f"  >> {title}"
    if detail:
        line += f" -- {detail}"
    print(line, flush=True)
    if _enabled and config.STEP_PAUSE > 0:
        time.sleep(config.STEP_PAUSE)


def highlight(driver, element, color: str = "#0d6efd") -> None:
    if not _enabled or element is None:
        return
    try:
        driver.execute_script(
            """
            const el = arguments[0], color = arguments[1];
            el.scrollIntoView({block: 'center', behavior: 'smooth'});
            el.style.outline = '3px solid ' + color;
            el.style.outlineOffset = '2px';
            el.style.transition = 'outline 0.2s';
            """,
            element,
            color,
        )
        time.sleep(min(config.STEP_PAUSE, 0.8) if config.STEP_PAUSE > 0 else 0.5)
    except Exception:
        pass


def clear_highlights(driver) -> None:
    if not _enabled:
        return
    try:
        driver.execute_script(
            """
            document.querySelectorAll('[style*="outline"]').forEach(el => {
                el.style.outline = '';
                el.style.outlineOffset = '';
            });
            """
        )
    except Exception:
        pass


def wait_before_close() -> None:
    if not _enabled and not config.KEEP_BROWSER_OPEN:
        return
    if not _enabled:
        time.sleep(3)
        return
    print("\n[watch] Browser stays open. Press Enter to close...", flush=True)
    try:
        input()
    except EOFError:
        print("(no terminal -- closing in 30 sec.)", flush=True)
        time.sleep(30)
