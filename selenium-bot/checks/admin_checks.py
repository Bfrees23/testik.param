# Admin panel: settings, counters, save.
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

import config
import watch
from helpers.session import ensure_admin
from pages.base import BasePage
from reporter import Report


def run_admin_checks(driver: WebDriver, report: Report) -> None:
    watch.step("Admin", "login and settings panel")
    if not ensure_admin(driver):
        report.fail("Admin", "login failed")
        return

    base = BasePage(driver)
    driver.get(f"{config.BASE_URL}/admin.html")
    base.wait_present(By.ID, "saveBtn")

    fields = [
        "adm_usb_vid", "adm_tm07_baud", "adm_tm07_addr", "adm_tm07_kao_pid",
        "adm_pkd_addr", "saveBtn", "resetServerBtn", "counterSelectAdmin",
        "saveCounterBtn", "pwdForm", "logoutBtn",
    ]
    missing = [f for f in fields if not driver.find_elements(By.ID, f)]
    if missing:
        report.fail("Admin: UI fields", "missing", ", ".join(missing))
    else:
        report.ok("Admin: UI fields", f"{len(fields)} elements")

    status = driver.find_element(By.ID, "adminStatus")
    st = (status.text or "").lower()
    if "error" not in st and "\u043e\u0448\u0438\u0431" not in st:
        report.ok("Admin: status", (status.text or "")[:80])
    else:
        report.fail("Admin: status", status.text)

    try:
        addr_el = driver.find_element(By.ID, "adm_tm07_addr")
        orig = addr_el.get_attribute("value")
        watch.step("Admin", "save settings")
        driver.execute_script("document.getElementById('saveBtn')?.click();")
        base.wait_until(
            lambda: any(
                x in (driver.find_element(By.ID, "adminStatus").text or "").lower()
                for x in ("save", "\u0441\u043e\u0445\u0440", "load", "\u0437\u0430\u0433\u0440\u0443\u0436")
            ),
            timeout=10,
        )
        report.ok("Admin: save", f"addr={orig}")
    except Exception as exc:
        report.fail("Admin: save", str(exc))

    try:
        sel = driver.find_element(By.ID, "counterSelectAdmin")
        opts = sel.find_elements(By.TAG_NAME, "option")
        report.ok("Admin: counters list", f"{len(opts)} option(s)")
    except Exception as exc:
        report.warn("Admin: counters list", str(exc))

    if driver.find_elements(By.ID, "pwdCurrent"):
        report.ok("Admin: password form", "present")

    try:
        driver.execute_script("document.getElementById('logoutBtn')?.click();")
        base.wait_until(lambda: "/login.html" in driver.current_url, timeout=8)
        report.ok("Admin: logout", "login.html")
    except Exception as exc:
        report.warn("Admin: logout", str(exc))
