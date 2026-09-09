# Home dashboard: filters, modules, sessions.
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support.ui import Select

import watch
from helpers.session import ensure_operator
from pages.base import BasePage
from reporter import Report


def run_home_checks(driver: WebDriver, report: Report) -> None:
    if not ensure_operator(driver):
        report.skip("Home", "no operator session")
        return

    watch.step("Home", "operator dashboard")
    base = BasePage(driver)
    base.open("/index.html")

    if not base.wait_until(lambda: base.is_visible("homeDashboard"), timeout=10):
        report.fail("Home: dashboard", "homeDashboard hidden")
        return
    report.ok("Home: dashboard", "visible")

    filt = driver.find_elements(By.ID, "homeSessionsFilter")
    if filt:
        try:
            Select(filt[0]).select_by_value("active")
            Select(filt[0]).select_by_value("closed")
            Select(filt[0]).select_by_value("all")
            report.ok("Home: session filter", "all/active/closed")
        except Exception as exc:
            report.fail("Home: session filter", str(exc))
    else:
        report.fail("Home: session filter", "missing #homeSessionsFilter")

    try:
        driver.execute_script("document.getElementById('homeRefreshBtn')?.click();")
        report.ok("Home: refresh", "click OK")
    except Exception as exc:
        report.fail("Home: refresh", str(exc))

    links = driver.find_elements(
        By.CSS_SELECTOR,
        "a[href*='tm07-workbench'], a[href*='parametrization'], a[href*='order-1c'], .bench-module a",
    )
    if links:
        report.ok("Home: quick links", f"{len(links)} link(s)")
    else:
        report.warn("Home: quick links", "not found")

    new_sess = driver.find_elements(By.CSS_SELECTOR, "a[href*='newSession=1']")
    if new_sess:
        report.ok("Home: new session link", new_sess[0].get_attribute("href") or "")
    else:
        report.fail("Home: new session link", "missing")

    body = driver.find_elements(By.ID, "homeSessionsBody")
    if body:
        rows = body[0].find_elements(By.CSS_SELECTOR, "tr")
        report.ok("Home: sessions table", f"{len(rows)} row(s)")
    else:
        report.fail("Home: sessions table", "missing #homeSessionsBody")
