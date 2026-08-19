"""Создание WebDriver Chrome для WSL/Docker/Linux."""
from __future__ import annotations

import atexit
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

import config

ROOT = Path(__file__).resolve().parent
DEFAULT_CHROME = ROOT / ".chrome" / "chrome-linux64" / "chrome"
DEFAULT_DRIVER = ROOT / ".chrome" / "chromedriver-linux64" / "chromedriver"

_chrome_proc: subprocess.Popen | None = None
_chrome_profile: str | None = None
DEBUG_PORT = int(os.getenv("CHROME_DEBUG_PORT", "9222"))


def _is_wsl() -> bool:
    if os.getenv("WSL_DISTRO_NAME"):
        return True
    try:
        with open("/proc/version", encoding="utf-8", errors="ignore") as fh:
            return "microsoft" in fh.read().lower()
    except OSError:
        return False


def _chrome_attach_mode(chrome_bin: str | None) -> bool:
    mode = os.getenv("CHROME_ATTACH", "auto").strip().lower()
    if mode in ("1", "true", "yes"):
        return True
    if mode in ("0", "false", "no"):
        return False
    return _is_wsl() or bool(chrome_bin and "/snap/" in chrome_bin)


def _resolve_binary(env_key: str, default: Path) -> str | None:
    val = os.getenv(env_key, "").strip()
    if val:
        return val
    if default.is_file():
        return str(default)
    return None


def _find_chrome() -> str | None:
    candidates = [
        os.getenv("CHROME_BINARY", "").strip(),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        "/snap/bin/chromium",
        shutil.which("google-chrome"),
        shutil.which("google-chrome-stable"),
    ]
    if DEFAULT_CHROME.is_file():
        candidates.append(str(DEFAULT_CHROME))
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def _find_driver(chrome_bin: str | None = None) -> str:
    candidates = [os.getenv("CHROMEDRIVER_PATH", "").strip()]
    if chrome_bin and "/snap/" in chrome_bin:
        candidates.extend([shutil.which("chromium.chromedriver"), "/snap/bin/chromium.chromedriver"])
    candidates.extend([
        shutil.which("chromedriver"),
        str(DEFAULT_DRIVER) if DEFAULT_DRIVER.is_file() else "",
    ])
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    from webdriver_manager.chrome import ChromeDriverManager

    return ChromeDriverManager().install()


def _build_options(headless: bool) -> Options:
    opts = Options()
    if headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--disable-extensions")
    opts.add_argument("--window-size=1400,900")
    opts.add_argument("--lang=ru-RU")
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    if config.KAO_COM_PORT and config.CHROME_PROFILE_DIR:
        config.CHROME_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        opts.add_argument(f"--user-data-dir={config.CHROME_PROFILE_DIR}")
    return opts


def _wait_debug_port(port: int, timeout: float = 15.0) -> None:
    url = f"http://127.0.0.1:{port}/json/version"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as resp:
                if resp.status == 200:
                    return
        except OSError:
            time.sleep(0.25)
    raise RuntimeError(f"Chrome remote debugging port {port} не открылся за {timeout}s")


def _start_chrome_debug(chrome_bin: str, headless: bool) -> None:
    global _chrome_proc, _chrome_profile
    if _chrome_proc and _chrome_proc.poll() is None:
        return
    _chrome_profile = tempfile.mkdtemp(prefix="selenium-chrome-")
    args = [
        chrome_bin,
        f"--remote-debugging-port={DEBUG_PORT}",
        f"--user-data-dir={_chrome_profile}",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
    ]
    if headless:
        args.append("--headless=new")
    args.append("about:blank")
    _chrome_proc = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    atexit.register(stop_chrome)
    _wait_debug_port(DEBUG_PORT)


def stop_chrome() -> None:
    global _chrome_proc, _chrome_profile
    if _chrome_proc and _chrome_proc.poll() is None:
        _chrome_proc.terminate()
        try:
            _chrome_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            _chrome_proc.kill()
    _chrome_proc = None
    if _chrome_profile and Path(_chrome_profile).exists():
        shutil.rmtree(_chrome_profile, ignore_errors=True)
    _chrome_profile = None


def create_driver() -> webdriver.Chrome:
    chrome_bin = _find_chrome()
    driver_path = _find_driver(chrome_bin)
    attach = _chrome_attach_mode(chrome_bin)

    if attach:
        if not chrome_bin:
            raise RuntimeError("CHROME_ATTACH=1, но бинарник Chrome не найден")
        _start_chrome_debug(chrome_bin, config.HEADLESS)
        opts = _build_options(headless=False)
        opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{DEBUG_PORT}")
        driver = webdriver.Chrome(service=Service(driver_path), options=opts)
        driver.implicitly_wait(config.IMPLICIT_WAIT)
        if not config.HEADLESS:
            try:
                driver.set_window_size(1400, 900)
                driver.maximize_window()
            except Exception:
                pass
        return driver

    opts = _build_options(config.HEADLESS)
    if chrome_bin:
        opts.binary_location = chrome_bin

    try:
        driver = webdriver.Chrome(service=Service(driver_path), options=opts)
    except Exception as exc:
        if chrome_bin:
            try:
                _start_chrome_debug(chrome_bin, config.HEADLESS)
                attach_opts = _build_options(headless=False)
                attach_opts.add_experimental_option("debuggerAddress", f"127.0.0.1:{DEBUG_PORT}")
                driver = webdriver.Chrome(service=Service(driver_path), options=attach_opts)
                driver.implicitly_wait(config.IMPLICIT_WAIT)
                return driver
            except Exception:
                pass
        hint = (
            "Установите Google Chrome или Chromium (libnss3, libnspr4). "
            "В WSL со snap: CHROME_ATTACH=1 или chromium из /snap/bin/chromium. "
            "Либо задайте CHROME_BINARY и CHROMEDRIVER_PATH в .env."
        )
        raise RuntimeError(f"{exc}\n\n{hint}") from exc

    driver.implicitly_wait(config.IMPLICIT_WAIT)
    if not config.HEADLESS:
        try:
            driver.set_window_size(1400, 900)
            driver.maximize_window()
        except Exception:
            pass
    return driver
