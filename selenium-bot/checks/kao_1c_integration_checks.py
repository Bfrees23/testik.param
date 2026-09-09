# Integration: KAO (COM8) + order load from 1C OData.
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

import config
import watch
from helpers.kao_odata import check_com_port, fetch_order_via_api
from helpers.session import ensure_operator, js_async
from pages.workbench import WorkbenchPage
from reporter import Report

ORDER_1C_SCRIPT = """
const order = arguments[0];
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const W = window.TM07_WORKBENCH;
    const E = window.TM07_BENCH_EVENTS;
    if (!W || !E) return done({ok: false, error: 'TM07_WORKBENCH / TM07_BENCH_EVENTS missing'});
    await E.refreshContext();
    if (!E.hasOperator || !E.hasOperator()) {
      return done({ok: false, error: 'operator not logged in'});
    }
    const inp = document.getElementById('paramOrder1cNumber');
    if (inp) {
      inp.value = order;
      inp.dispatchEvent(new Event('input', {bubbles: true}));
    }
    const r = await W.prepareOrderFromInput(true);
    const status = (document.getElementById('paramOrder1cStatus') || {}).textContent || '';
    const badge = (document.getElementById('paramOrder1cOrderStatus') || {}).textContent || '';
    const filled = (r && r.result && r.result.apply && r.result.apply.filled) || 0;
    done({
      ok: true,
      number: r && r.number,
      filled: filled,
      cached: !!(r && r.cached),
      status: status.trim(),
      badge: badge.trim(),
      session: E.hasActiveOrder && E.hasActiveOrder(),
    });
  } catch (e) {
    done({ok: false, error: String(e.message || e)});
  }
})();
"""

KAO_CONNECT_SCRIPT = """
const timeoutSec = arguments[0];
const useAnyUsb = arguments[1];
const done = arguments[arguments.length - 1];
(async () => {
  const K = window.TM07_PARAM_KAO;
  if (!K) return done({ok: false, error: 'TM07_PARAM_KAO not loaded'});
  const filterKao = !useAnyUsb;
  try {
    await K.tryAutoReconnect(filterKao, true, true);
  } catch (_e) {}
  if (!K.isPortOpen || !K.isPortOpen()) {
    const btnId = useAnyUsb ? 'paramConnectAny' : 'paramConnectKao';
    const btn = document.getElementById(btnId);
    if (btn && !(K.isConnectBusy && K.isConnectBusy())) {
      btn.click();
    }
  }
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (K.isPortOpen && K.isPortOpen()) {
      const st = ((document.getElementById('paramConnStatus') || {}).textContent || '').trim();
      const pp = K.getDevicePassport ? K.getDevicePassport() : null;
      const low = st.toLowerCase();
      const linked = (low.includes('addr') || low.includes('connected') || low.includes('com'))
        && !low.includes('error') && !low.includes('fail');
      return done({
        ok: true,
        status: st,
        linked: linked,
        passport: pp ? (pp.serial || pp.name || pp.fwVersion || 'ok') : null,
      });
    }
    if (K.isConnectBusy && K.isConnectBusy()) {
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return done({
    ok: false,
    error: 'KAO connect timeout',
    status: ((document.getElementById('paramConnStatus') || {}).textContent || '').trim(),
    hint: 'Select COM8 in browser (--watch) or grant port in Chrome profile',
  });
})();
"""

ASSEMBLY_AFTER_ORDER = """
const done = arguments[arguments.length - 1];
(async () => {
  try {
    const W = window.TM07_WORKBENCH;
    const E = window.TM07_BENCH_EVENTS;
    const serial = await W.generateCorrectorSerial();
    await W.confirmAssemblyStep();
    done({
      ok: true,
      serial: serial,
      stage: E.getSessionStage(),
      canParam: E.canAccessParametrization && E.canAccessParametrization(),
    });
  } catch (e) {
    done({ok: false, error: String(e.message || e)});
  }
})();
"""


def _status_has_error(text: str) -> bool:
    low = (text or "").lower()
    return "error" in low or "\u043e\u0448\u0438\u0431" in low or "fail" in low


def run_kao_1c_integration(driver: WebDriver, report: Report) -> None:
    watch.step("Integration", "COM + 1C + KAO")

    com = check_com_port()
    if com.get("ok"):
        report.ok("KAO: COM port", f"{com['port']} @ {com['baud']} baud")
    else:
        report.warn("KAO: COM port", com.get("error", "?"), f"port={config.KAO_COM_PORT}")

    watch.step("Integration", "OData API")
    try:
        odata = fetch_order_via_api(config.TEST_ORDER_NUMBER)
        rows = odata.get("rows") or []
        if rows:
            num = rows[0].get("Number") or "?"
            report.ok("1C OData: API", f"{len(rows)} row(s), Number={num}")
        else:
            report.fail("1C OData: API", "empty value[]")
    except Exception as exc:
        report.fail("1C OData: API", str(exc))

    if not ensure_operator(driver):
        report.skip("Integration UI", "no operator")
        return

    wb = WorkbenchPage(driver)
    wb.open_workbench(new_session=True)
    wb.dismiss_operator_modal_if_present()
    wb.dismiss_guide_if_present()

    watch.step("Integration", "workbench order from 1C")
    order_result = None
    try:
        order_result = js_async(driver, ORDER_1C_SCRIPT, config.TEST_ORDER_NUMBER, timeout=60)
    except Exception as exc:
        report.fail("1C: workbench load", str(exc))

    if order_result and order_result.get("ok"):
        filled = int(order_result.get("filled") or 0)
        st = order_result.get("status") or ""
        if _status_has_error(st):
            report.fail("1C: workbench load", st)
        elif filled > 0:
            report.ok("1C: workbench load", f"filled {filled} fields")
        elif order_result.get("cached"):
            report.ok("1C: workbench load", "cached")
        else:
            report.warn("1C: workbench load", st or "no fields filled")
    elif order_result:
        report.fail("1C: workbench load", order_result.get("error", "?"))

    watch.step("Integration", "assembly")
    try:
        asm = js_async(driver, ASSEMBLY_AFTER_ORDER, timeout=45)
        if asm and asm.get("ok") and asm.get("canParam"):
            report.ok("Integration: assembly", f"S/N {asm.get('serial')}")
        elif asm:
            report.fail("Integration: assembly", asm.get("error", str(asm)))
    except Exception as exc:
        report.fail("Integration: assembly", str(exc))

    watch.step("Integration", f"KAO connect {config.KAO_COM_PORT}")
    kao = None
    try:
        kao = js_async(
            driver,
            KAO_CONNECT_SCRIPT,
            int(config.KAO_CONNECT_TIMEOUT),
            config.KAO_USE_ANY_USB,
            timeout=config.KAO_CONNECT_TIMEOUT + 20,
        )
    except Exception as exc:
        report.fail("KAO: browser connect", str(exc))

    if kao and kao.get("ok"):
        report.ok("KAO: browser connect", (kao.get("status") or "")[:100])
        if kao.get("passport"):
            report.ok("KAO: passport", str(kao.get("passport"))[:60])
    elif kao:
        err = kao.get("error") or kao.get("status") or ""
        if "NotFoundError" in err or "cancel" in err.lower():
            report.warn(
                "KAO: browser connect",
                "select COM8 manually",
                "python run_bot.py --watch -> paramConnectAny -> COM8",
            )
        else:
            report.fail("KAO: browser connect", err, kao.get("hint", ""))

    write_btn = driver.find_elements(By.ID, "paramWriteAll")
    if write_btn and kao and kao.get("ok") and not write_btn[0].get_attribute("disabled"):
        report.ok("KAO: paramWriteAll", "enabled")

    watch.step("Integration", "order-1c page")
    driver.get(f"{config.BASE_URL}/order-1c.html")
    try:
        inp = driver.find_element(By.ID, "orderNumberInput")
        short = config.TEST_ORDER_NUMBER.replace("\u0422\u041c00-", "").replace("TM00-", "")
        driver.execute_script(
            "arguments[0].value=arguments[1]; arguments[0].dispatchEvent(new Event('input',{bubbles:true}));",
            inp,
            short,
        )
        driver.execute_script("document.getElementById('orderLoadBtn')?.click();")
        wb.wait_until(
            lambda: len(driver.find_elements(By.CSS_SELECTOR, "#orderResultBody tr")) > 0
            or _status_has_error(driver.find_element(By.ID, "orderStatus").text),
            timeout=35,
        )
        rows = len(driver.find_elements(By.CSS_SELECTOR, "#orderResultBody tr"))
        status = driver.find_element(By.ID, "orderStatus").text[:120]
        if rows > 0:
            report.ok("1C: order page", f"{rows} rows")
        elif _status_has_error(status):
            report.fail("1C: order page", status)
        else:
            report.warn("1C: order page", status)
    except Exception as exc:
        report.fail("1C: order page", str(exc))
