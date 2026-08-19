"""Расширенные проверки всех API."""
from __future__ import annotations

import json

import requests

import config
from reporter import Report


def _get(url: str, **kwargs) -> requests.Response:
    return requests.get(url, timeout=kwargs.pop("timeout", 15), **kwargs)


def _post(url: str, payload: dict | None = None, **kwargs) -> requests.Response:
    return requests.post(
        url,
        json=payload or {},
        timeout=kwargs.pop("timeout", 15),
        **kwargs,
    )


def _admin_session() -> requests.Session | None:
    s = requests.Session()
    try:
        r = s.post(
            f"{config.BASE_URL}/api/auth.php?action=login",
            json={"password": config.ADMIN_PASSWORD},
            timeout=15,
        )
        if r.status_code == 200 and r.json().get("success"):
            return s
    except requests.RequestException:
        pass
    return None


def _operator_session() -> requests.Session | None:
    s = requests.Session()
    try:
        r = s.post(
            f"{config.BASE_URL}/api/bench-db-status.php",
            json=config.operator_select_payload("selenium-bot-api"),
            timeout=15,
        )
        if r.status_code == 200 and r.json().get("ok"):
            return s
    except requests.RequestException:
        pass
    return None


def _run_api_item(
    report: Report,
    method: str,
    path: str,
    ok_key: str,
    body: dict | None = None,
    session: requests.Session | None = None,
) -> None:
    suffix = " + body" if body else ""
    if session is not None:
        suffix += " (operator)"
    name = f"API {method} {path.split('?')[0]}{suffix}"
    try:
        url = f"{config.BASE_URL}{path}"
        client = session or requests
        if method == "GET":
            resp = client.get(url, timeout=15)
        else:
            resp = client.post(url, json=body or {}, timeout=15)
        if resp.status_code != 200:
            report.fail(name, f"HTTP {resp.status_code}", resp.text[:200])
            return
        data = resp.json()
        if data.get(ok_key) in (True, "ok", "success") or data.get("success") is True:
            detail = ""
            if "serial" in data:
                detail = f"serial={data.get('serial')}"
            elif "types" in data:
                detail = f"{len(data['types'])} types"
            elif "events" in data:
                detail = f"{len(data['events'])} events"
            elif "sessions" in data:
                detail = f"{len(data['sessions'])} sessions"
            elif "counters" in data:
                detail = f"{len(data.get('counters') or [])} counters"
            report.ok(name, detail or "OK")
        else:
            report.fail(name, "unexpected response", json.dumps(data, ensure_ascii=False)[:300])
    except (requests.RequestException, json.JSONDecodeError) as exc:
        report.fail(name, str(exc))


def run_api_checks(report: Report) -> None:
    for method, path, ok_key in config.API_CHECKS:
        url = f"{config.BASE_URL}{path}"
        name = f"API {method} {path}"
        try:
            resp = _get(url) if method == "GET" else _post(url)
            if resp.status_code != 200:
                report.fail(name, f"HTTP {resp.status_code}", resp.text[:300])
                continue
            data = resp.json()
            if data.get(ok_key) in (True, "ok", "success") or data.get("success") is True:
                if "admin-settings" in path and "public" in path:
                    settings = data.get("settings") or {}
                    forbidden = {"adminPassword", "odataPassword", "firebirdPassword"}
                    leaked = forbidden & set(settings.keys())
                    if leaked:
                        report.fail(name, f"leaked keys: {sorted(leaked)}")
                    else:
                        report.ok(name, f"{len(settings)} public keys")
                else:
                    report.ok(name, "OK")
            else:
                report.fail(name, f"Ключ «{ok_key}»", json.dumps(data, ensure_ascii=False)[:400])
        except (requests.RequestException, json.JSONDecodeError) as exc:
            report.fail(name, str(exc))

    extras = [
        ("GET", "/api/bench-db-status.php?action=sessions&limit=5", "ok", None),
        ("GET", "/api/bench-events.php?action=types", "ok", None),
        ("GET", "/api/bench-events.php?action=last&limit=3", "ok", None),
        ("GET", "/api/bench-events.php?action=list&limit=3", "ok", None),
        ("GET", "/api/odata-1c.php?action=config", "ok", None),
        ("GET", "/api/counters.php?action=list", "success", None),
        ("GET", "/api/bench-cycle-progress.php?action=get&serial=TEST000", "ok", None),
        ("POST", "/api/bench-events.php", "ok", {"action": "log", "eventType": "assembly_confirm", "detail": "bot"}),
    ]
    for method, path, ok_key, body in extras:
        _run_api_item(report, method, path, ok_key, body)

    operator = _operator_session()
    if operator:
        for body in [
            {"action": "peek", "kind": "corrector"},
            {"action": "peek", "kind": "complex"},
        ]:
            _run_api_item(report, "POST", "/api/tm07-serial-registry.php", "ok", body, operator)
    else:
        report.warn("API operator session", "Не удалось войти как оператор для serial-registry")

    name = "API POST /api/tm07-serial-registry.php (no auth)"
    try:
        resp = _post(
            f"{config.BASE_URL}/api/tm07-serial-registry.php",
            {"action": "peek", "kind": "corrector"},
        )
        if resp.status_code == 403:
            report.ok(name, "403 as expected")
        else:
            report.fail(name, f"HTTP {resp.status_code}", resp.text[:200])
    except (requests.RequestException, json.JSONDecodeError) as exc:
        report.fail(name, str(exc))

    name = "API POST /api/site-action-log.php"
    try:
        resp = _post(
            f"{config.BASE_URL}/api/site-action-log.php",
            {"category": "ui", "action": "selenium_full", "detail": "bot run"},
        )
        report.ok(name, "OK") if resp.json().get("ok") else report.fail(name, resp.text[:200])
    except Exception as exc:
        report.fail(name, str(exc))

    admin = _admin_session()
    if admin:
        for path, label in [
            ("/api/admin-settings.php?action=get", "get settings"),
            ("/api/auth.php?action=status", "auth status logged in"),
        ]:
            name = f"API GET {path} (admin)"
            try:
                resp = admin.get(f"{config.BASE_URL}{path}", timeout=15)
                data = resp.json()
                if data.get("success") or data.get("ok"):
                    if "loggedIn" in data:
                        report.ok(name, f"loggedIn={data['loggedIn']}")
                    else:
                        report.ok(name, label)
                else:
                    report.fail(name, json.dumps(data, ensure_ascii=False)[:200])
            except Exception as exc:
                report.fail(name, str(exc))
        admin.post(f"{config.BASE_URL}/api/auth.php?action=logout", json={})
    else:
        report.warn("API admin session", "Не удалось войти как админ для API-тестов")

    name = "API POST /api/auth.php wrong password"
    try:
        resp = _post(
            f"{config.BASE_URL}/api/auth.php?action=login",
            {"password": "wrong-password-xyz"},
        )
        data = resp.json()
        if resp.status_code == 403 and not data.get("success"):
            report.ok(name, data.get("error") or "403")
        else:
            report.fail(name, f"HTTP {resp.status_code}", json.dumps(data, ensure_ascii=False)[:200])
    except (requests.RequestException, json.JSONDecodeError) as exc:
        report.fail(name, str(exc))

    for path, label in [
        ("/js/admin-panel.js", "admin-panel.js"),
        ("/js/site-settings-cache.js", "site-settings-cache.js"),
        ("/favicon.ico", "favicon"),
    ]:
        name = f"Static GET {path}"
        try:
            resp = _get(f"{config.BASE_URL}{path}")
            if resp.status_code == 200 and len(resp.content) > 0:
                report.ok(name, label)
            else:
                report.fail(name, f"HTTP {resp.status_code}")
        except requests.RequestException as exc:
            report.fail(name, str(exc))

    name = "API GET /api/odata-1c.php (no auth path)"
    try:
        resp = _get(f"{config.BASE_URL}/api/odata-1c.php", params={"path": "Document_ЗаказНаПроизводство2_2?$format=json&$top=1"})
        if resp.status_code == 403:
            report.ok(name, "403 as expected")
        else:
            report.fail(name, f"HTTP {resp.status_code}", resp.text[:200])
    except requests.RequestException as exc:
        report.fail(name, str(exc))

    name = "API POST /api/passport-generate.php (no auth)"
    try:
        resp = _post(f"{config.BASE_URL}/api/passport-generate.php", {"kind": "auto", "orderNumber": "TEST"})
        if resp.status_code == 403:
            report.ok(name, "403 as expected")
        else:
            report.fail(name, f"HTTP {resp.status_code}", resp.text[:200])
    except requests.RequestException as exc:
        report.fail(name, str(exc))

    if operator:
        name = "API GET /api/odata-1c.php (operator path)"
        try:
            resp = operator.get(
                f"{config.BASE_URL}/api/odata-1c.php",
                params={"path": "Document_ЗаказНаПроизводство2_2?$format=json&$top=1"},
                timeout=30,
            )
            if resp.status_code == 200:
                report.ok(name, "200")
            elif resp.status_code in (502, 503, 504):
                report.warn(name, f"HTTP {resp.status_code} (1C unreachable?)")
            else:
                report.fail(name, f"HTTP {resp.status_code}", resp.text[:200])
        except requests.RequestException as exc:
            report.fail(name, str(exc))
