# Navigation, header, operator/admin slot.
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

import config
import watch
from helpers.session import ensure_admin, ensure_operator
from pages.base import BasePage
from reporter import Report


def run_navigation_checks(driver: WebDriver, report: Report) -> None:
    base = BasePage(driver)
    watch.step("Nav", "header and auth slot")

    driver.get(f"{config.BASE_URL}/index.html")
    base.wait_present(By.CSS_SELECTOR, "[data-bench-header]")

    links = driver.find_elements(By.CSS_SELECTOR, ".bench-nav-link")
    report.ok("Nav: links", f"{len(links)}")

    toggle = driver.find_elements(By.CSS_SELECTOR, "[data-bench-nav-toggle]")
    if toggle:
        try:
            driver.execute_script("arguments[0].click();", toggle[0])
            report.ok("Nav: mobile toggle", "OK")
            driver.execute_script("arguments[0].click();", toggle[0])
        except Exception as exc:
            report.warn("Nav: mobile toggle", str(exc))

    if ensure_operator(driver):
        driver.get(f"{config.BASE_URL}/tm07-workbench.html")
        base.wait_present(By.CSS_SELECTOR, "[data-bench-header]")
        base.wait_until(
            lambda: (
                (driver.find_element(By.ID, "navAuthSlot").text or "").strip() != ""
                or driver.find_elements(By.ID, "navOperatorBtn")
            ),
            timeout=8,
        )
        slot = driver.find_elements(By.ID, "navAuthSlot")
        slot_text = (slot[0].text or "").strip() if slot else ""
        if slot_text and "Оператор" not in slot_text:
            report.ok("Nav: operator slot", slot_text[:60])
        elif slot_text:
            report.warn("Nav: operator slot", slot_text[:60] or "empty")
        else:
            report.warn("Nav: operator slot", "empty")

    if ensure_admin(driver):
        driver.get(f"{config.BASE_URL}/index.html")
        admin_el = driver.find_elements(By.CSS_SELECTOR, "a[href*='admin.html'], #navLogoutBtn")
        if admin_el:
            report.ok("Nav: admin elements", f"{len(admin_el)}")
        else:
            report.warn("Nav: admin elements", "not in header")
