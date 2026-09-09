# Parametrization KAO and counters pages.
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

import config
import watch
from fixtures.sample_order import SAMPLE_ORDER_JSON
from helpers.session import ensure_operator, js_async
from pages.base import BasePage
from reporter import Report

PEEK_SERIAL = """
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const r = await fetch('/api/tm07-serial-registry.php', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'peek', kind: 'corrector'}),
    });
    const j = await r.json();
    done(j);
  } catch (e) { done({ok: false, error: String(e)}); }
})();
"""


def _check_param_page(driver: WebDriver, report: Report, path: str, title: str) -> None:
    base = BasePage(driver)
    watch.step(title, path)
    driver.get(f"{config.BASE_URL}{path}")
    base.wait_present(By.ID, "paramConnectKao")

    ids_common = [
        "paramAddr", "paramBaud", "paramConnectKao", "paramConnectAny", "paramDisconnect",
        "paramConnStatus", "paramFilter", "paramReadAll", "paramWriteAll", "paramTbody",
        "paramOrder1cNumber", "paramClearLog", "paramLog",
    ]
    ids = ids_common + (["paramQrSensor"] if "counters" not in path else [])
    missing = [i for i in ids if not driver.find_elements(By.ID, i)]
    if missing:
        report.fail(f"{title}: elements", ", ".join(missing))
    else:
        report.ok(f"{title}: elements", f"{len(ids)} controls")

    rows = len(driver.find_elements(By.CSS_SELECTOR, "#paramTbody tr"))
    if rows >= 5:
        report.ok(f"{title}: table", f"{rows} rows")
    else:
        report.fail(f"{title}: table", f"only {rows} rows")

    try:
        flt = driver.find_element(By.ID, "paramFilter")
        flt.clear()
        flt.send_keys("57")
        report.ok(f"{title}: filter", "search 57")
    except Exception as exc:
        report.fail(f"{title}: filter", str(exc))

    try:
        driver.find_element(By.ID, "paramAddr").clear()
        driver.find_element(By.ID, "paramAddr").send_keys("2")
        report.ok(f"{title}: modbus addr", "2")
    except Exception as exc:
        report.fail(f"{title}: modbus addr", str(exc))


def run_parametrization_checks(driver: WebDriver, report: Report) -> None:
    if not ensure_operator(driver):
        report.skip("Parametrization", "no operator")
        return

    base = BasePage(driver)
    _check_param_page(driver, report, "/tm07-parametrization-kao.html", "Param KAO")

    watch.step("Param KAO", "apply order JSON")
    try:
        ta = driver.find_element(By.ID, "paramOrder1cJson")
        driver.execute_script(
            "arguments[0].value = arguments[1]; arguments[0].dispatchEvent(new Event('input',{bubbles:true}));",
            ta,
            SAMPLE_ORDER_JSON,
        )
        driver.execute_script("document.getElementById('paramOrder1cApplyJson')?.click();")
        base.wait_until(
            lambda: "000001"
            in (driver.find_element(By.ID, "paramOrder1cNumber").get_attribute("value") or ""),
            timeout=8,
        )
        val = driver.find_element(By.ID, "paramOrder1cNumber").get_attribute("value") or ""
        if "000001" in val:
            report.ok("Param KAO: order JSON", val)
        else:
            report.warn("Param KAO: order JSON", f"value={val}")
    except Exception as exc:
        report.fail("Param KAO: order JSON", str(exc))

    try:
        peek = js_async(driver, PEEK_SERIAL, timeout=10)
        if peek and peek.get("ok"):
            report.ok("Param KAO: serial peek", str(peek.get("serial") or peek.get("next") or "OK"))
        else:
            report.fail("Param KAO: serial peek", str(peek))
    except Exception as exc:
        report.fail("Param KAO: serial peek", str(exc))

    for btn_id in ("paramSerialGenCorrector", "paramSerialGenComplex", "paramSerialGenPair"):
        if driver.find_elements(By.ID, btn_id):
            report.ok(f"Param KAO: {btn_id}", "present")
        else:
            report.warn(f"Param KAO: {btn_id}", "missing")

    _check_param_page(driver, report, "/tm07-parametrization-kao-counters.html", "Param counters")
    counter_sel = driver.find_elements(By.ID, "counterSelect")
    load_btn = driver.find_elements(By.ID, "loadCounterBtn")
    if counter_sel and load_btn:
        opts = counter_sel[0].find_elements(By.TAG_NAME, "option")
        if len(opts) > 1:
            try:
                driver.execute_script(
                    "arguments[0].selected=true; document.getElementById('loadCounterBtn')?.click();",
                    opts[1],
                )
                report.ok("Param counters: load preset", opts[1].get_attribute("value") or "")
            except Exception as exc:
                report.warn("Param counters: load preset", str(exc))
        else:
            report.ok("Param counters: select", f"{len(opts)} option(s)")
    else:
        report.fail("Param counters: UI", "counterSelect/loadCounterBtn missing")

    for panel_id in ("paramMeterPanel", "paramComplexPanel"):
        if driver.find_elements(By.ID, panel_id):
            report.ok(f"Param KAO: {panel_id}", "accordion present")
