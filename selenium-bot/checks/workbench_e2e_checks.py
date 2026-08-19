# Workbench E2E: order -> assembly -> parametrization unlock.
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

import config
import watch
from helpers.session import ensure_operator, js_async
from pages.workbench import WorkbenchPage
from reporter import Report

E2E_SCRIPT = """
const order = arguments[0];
const midaQr = arguments[1];
const meterSn = arguments[2];
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const E = window.TM07_BENCH_EVENTS;
    const W = window.TM07_WORKBENCH;
    if (!E || !W) return done({ok: false, step: 'init', error: 'TM07 modules missing'});
    await E.refreshContext();
    if (!E.hasOperator || !E.hasOperator()) {
      return done({ok: false, step: 'operator', error: 'operator not logged in'});
    }
    await E.selectOrder(order);
    const serial = await W.generateCorrectorSerial();
    if (!/^300\\d{7}$/.test(String(serial))) {
      return done({ok: false, step: 'serial', error: 'bad serial: ' + serial});
    }
    await W.confirmAssemblyStep();
    const stage = E.getSessionStage();
    const section = document.getElementById('wbParamSection');
    const unlocked = section && !section.classList.contains('wb-param-locked');
    const qr = document.getElementById('paramQrSensor');
    if (qr) {
      qr.value = midaQr;
      qr.dispatchEvent(new Event('input', {bubbles: true}));
      qr.dispatchEvent(new Event('change', {bubbles: true}));
    }
    const meter = document.getElementById('paramMeterSerial');
    if (meter) {
      meter.value = meterSn;
      meter.dispatchEvent(new Event('input', {bubbles: true}));
    }
    const filter = document.getElementById('paramFilter');
    if (filter) {
      filter.value = '6';
      filter.dispatchEvent(new Event('input', {bubbles: true}));
    }
    const rows = document.querySelectorAll('#paramTbody tr').length;
    const writeBtn = document.getElementById('paramWriteAll');
    const writeDisabled = writeBtn ? writeBtn.disabled : null;
    done({
      ok: true,
      serial,
      stage,
      unlocked,
      rows,
      writeDisabled,
      canParam: E.canAccessParametrization && E.canAccessParametrization(),
    });
  } catch (e) {
    done({ok: false, step: 'exception', error: String(e.message || e)});
  }
})();
"""

CLEANUP_SCRIPT = """
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const E = window.TM07_BENCH_EVENTS;
    if (E && E.clearOrder) await E.clearOrder('selenium_bot_cleanup');
    done({ok: true});
  } catch (e) {
    done({ok: false, error: String(e.message || e)});
  }
})();
"""


def run_workbench_e2e(driver: WebDriver, report: Report) -> None:
    watch.step("Workbench E2E", "full session flow")
    if not ensure_operator(driver):
        report.skip("Workbench E2E", "no operator")
        return

    wb = WorkbenchPage(driver)
    wb.open_workbench(new_session=True)
    wb.dismiss_operator_modal_if_present()
    wb.dismiss_guide_if_present()

    try:
        result = js_async(
            driver,
            E2E_SCRIPT,
            config.TEST_ORDER_NUMBER,
            config.MIDA_QR_SAMPLE,
            "12345678",
            timeout=45,
        )
    except Exception as exc:
        report.fail("Workbench E2E", "timeout", str(exc))
        return

    if not result or not result.get("ok"):
        report.fail(
            "Workbench E2E",
            result.get("step", "?") if result else "no result",
            result.get("error", "") if result else "",
        )
        return

    report.ok("Workbench E2E: order", config.TEST_ORDER_NUMBER)
    report.ok("Workbench E2E: serial", str(result.get("serial")))
    report.ok("Workbench E2E: stage", str(result.get("stage")))
    if result.get("unlocked") and result.get("canParam"):
        report.ok("Workbench E2E: unlock", "parametrization available")
    else:
        report.fail(
            "Workbench E2E: unlock",
            f"unlocked={result.get('unlocked')} canParam={result.get('canParam')}",
        )
    report.ok("Workbench E2E: table rows", str(result.get("rows")))
    if result.get("writeDisabled") is True:
        report.warn("Workbench E2E: write all", "disabled (no KAO hardware)")
    else:
        report.ok("Workbench E2E: write all", "button state OK")

    try:
        badges = driver.find_elements(By.CSS_SELECTOR, "#wbSensorBadges .badge")
        meter_badge = driver.find_element(By.ID, "wbMeterBadge").text
        if badges:
            report.ok("Workbench E2E: QR badges", f"{len(badges)}")
        else:
            report.warn("Workbench E2E: QR badges", "empty")
        report.ok("Workbench E2E: meter badge", meter_badge[:40])
    except Exception as exc:
        report.warn("Workbench E2E: post-QR UI", str(exc))

    watch.step("Workbench E2E", "cleanup session")
    try:
        cleanup = js_async(driver, CLEANUP_SCRIPT, timeout=15)
        if cleanup and cleanup.get("ok"):
            report.ok("Workbench E2E: cleanup", "clearOrder OK")
        else:
            report.warn("Workbench E2E: cleanup", str(cleanup))
    except Exception as exc:
        report.warn("Workbench E2E: cleanup", str(exc))

    close_btn = driver.find_elements(By.ID, "wbOrderSessionClose")
    if close_btn and close_btn[0].is_displayed():
        report.warn("Workbench E2E: session", "still open")
    else:
        report.ok("Workbench E2E: session closed", "OK")
