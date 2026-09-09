"""Настройки бота из переменных окружения и .env."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")

BASE_URL = os.getenv("BASE_URL", "http://localhost:8081").rstrip("/")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")
# Тестовый оператор (модальное окно входа — фамилия и имя)
OPERATOR_LAST_NAME = os.getenv("OPERATOR_LAST_NAME", "Тестов")
OPERATOR_FIRST_NAME = os.getenv("OPERATOR_FIRST_NAME", "Бот")
# Устарело: табельный № больше не вводится; login генерируется на сервере
OPERATOR_LOGIN = os.getenv("OPERATOR_LOGIN", "")
OPERATOR_PIN = os.getenv("OPERATOR_PIN", os.getenv("BENCH_OPERATOR_PIN", "")).strip()


def operator_select_payload(fingerprint: str = "selenium-bot") -> dict:
    payload = {
        "action": "selectOperator",
        "lastName": OPERATOR_LAST_NAME,
        "firstName": OPERATOR_FIRST_NAME,
        "fingerprint": fingerprint,
    }
    if OPERATOR_PIN:
        payload["pin"] = OPERATOR_PIN
    return payload
TEST_ORDER_NUMBER = os.getenv("TEST_ORDER_NUMBER", "ТМ00-000001")
KAO_COM_PORT = os.getenv("KAO_COM_PORT", "COM8").strip()
KAO_BAUD = int(os.getenv("KAO_BAUD", "19200"))
KAO_CONNECT_TIMEOUT = float(os.getenv("KAO_CONNECT_TIMEOUT", "90"))
KAO_USE_ANY_USB = os.getenv("KAO_USE_ANY_USB", "1").strip().lower() in ("1", "true", "yes")
ODATA_ENTITY = os.getenv("ODATA_ENTITY", "Document_ЗаказНаПроизводство2_2")
CHROME_PROFILE_DIR = ROOT / ".chrome-profile"
HEADLESS = os.getenv("HEADLESS", "1").strip() not in ("0", "false", "False", "no")
STEP_PAUSE = float(os.getenv("STEP_PAUSE", "0"))
KEEP_BROWSER_OPEN = os.getenv("KEEP_BROWSER_OPEN", "").strip().lower() in ("1", "true", "yes")
VERBOSE = os.getenv("VERBOSE", "").strip().lower() in ("1", "true", "yes")
RUN_REPEAT = max(1, int(os.getenv("RUN_REPEAT", "1") or "1"))
REPEAT_INTERVAL = max(0.0, float(os.getenv("REPEAT_INTERVAL", "0") or "0"))
STOP_ON_FAIL = os.getenv("STOP_ON_FAIL", "").strip().lower() in ("1", "true", "yes")
SKIP_KAO = os.getenv("SKIP_KAO", "").strip().lower() in ("1", "true", "yes")
IMPLICIT_WAIT = float(os.getenv("IMPLICIT_WAIT", "2"))
EXPLICIT_WAIT = float(os.getenv("EXPLICIT_WAIT", "15"))
REPORTS_DIR = ROOT / "reports"

PAGES = [
    ("/index.html", "home", "css", "#homeLoginBtn"),
    ("/tm07-workbench.html", "workbench", "id", "wbCorrectorCard"),
    ("/tm07-parametrization-kao.html", "parametrization", "id", "paramConnectKao"),
    ("/tm07-parametrization-kao-counters.html", "param_counters", "id", "paramConnectKao"),
    ("/order-1c.html", "order_1c", "id", "orderNumberInput"),
    ("/login.html", "login", "id", "loginForm"),
    ("/test-process-m90-15c.html", "m90_test", "css", "[data-bench-header]"),
]

NAV_LINKS = [
    "/index.html",
    "/tm07-parametrization-kao.html",
    "/tm07-workbench.html",
    "/order-1c.html",
]

API_CHECKS = [
    ("GET", "/api/bench-db-status.php?action=status", "ok"),
    ("GET", "/api/auth.php?action=status", "success"),
    ("GET", "/api/admin-settings.php?action=public", "success"),
]

MIDA_QR_SAMPLE = "24428615;MIDA;DA;15;EX;IP65;0.25;0.08;0.2;MPa;064;DINC"
