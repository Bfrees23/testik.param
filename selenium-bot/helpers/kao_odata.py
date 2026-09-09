# COM port preflight and OData helpers.
from __future__ import annotations

import json
from datetime import datetime

import requests

import config


def build_odata_path(order_number: str, entity: str | None = None) -> str:
    entity = entity or config.ODATA_ENTITY
    year = datetime.now().year
    n = order_number.replace("TM", "\u0422\u041c").replace("tm", "\u0422\u041c")
    if n.isdigit():
        n = f"\u0422\u041c00-{int(n):06d}"
    n = n.replace("'", "''")
    q = (
        f"$format=json&$filter=Number eq '{n}' "
        f"and Date ge datetime'{year}-01-01T00:00:00' "
        f"and Date lt datetime'{year + 1}-01-01T00:00:00'"
    )
    return f"{entity}?{q}"


def _operator_session() -> requests.Session | None:
    s = requests.Session()
    try:
        r = s.post(
            f"{config.BASE_URL}/api/bench-db-status.php",
            json=config.operator_select_payload("selenium-bot-odata"),
            timeout=15,
        )
        if r.status_code == 200 and r.json().get("ok"):
            return s
    except requests.RequestException:
        pass
    return None


def fetch_order_via_api(order_number: str, session: requests.Session | None = None) -> dict:
    path = build_odata_path(order_number)
    url = f"{config.BASE_URL}/api/odata-1c.php"
    client = session or _operator_session()
    if client is None:
        raise RuntimeError("Operator session required for OData proxy")
    resp = client.get(url, params={"path": path}, timeout=45)
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
    try:
        data = resp.json()
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Not JSON: {resp.text[:200]}") from exc
    if isinstance(data, dict) and data.get("error") and "value" not in data:
        detail = data.get("detail") or data.get("odata.error") or data.get("error")
        raise RuntimeError(str(detail)[:300])
    if isinstance(data, dict) and isinstance(data.get("value"), list):
        rows = data["value"]
    elif isinstance(data, list):
        rows = data
    else:
        rows = []
    return {"rows": rows, "raw": data, "path": path}


def check_com_port(port: str | None = None, baud: int | None = None) -> dict:
    port = port or config.KAO_COM_PORT
    baud = baud or config.KAO_BAUD
    try:
        import serial
    except ImportError:
        return {"ok": False, "error": "pyserial not installed", "port": port}

    if not port:
        return {"ok": False, "error": "KAO_COM_PORT empty"}

    try:
        ser = serial.Serial(port, baudrate=baud, timeout=1)
        ser.close()
        return {"ok": True, "port": port, "baud": baud}
    except Exception as exc:
        return {"ok": False, "port": port, "baud": baud, "error": str(exc)}
