"""Shared session helpers for operator/admin login."""
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

import config
from pages.home import HomePage, OperatorModal
from pages.login import LoginPage


def ensure_operator(driver: WebDriver) -> bool:
    home = HomePage(driver)
    modal = OperatorModal(driver)
    try:
        home.open_home()
        if home.wait_until(
            lambda: home.operator_dashboard_visible() or home.is_visible("homeLoginBtn"),
            timeout=12,
        ) and home.operator_dashboard_visible():
            return True
        if home.is_visible("homeLoginBtn"):
            home.click_operator_login()
        else:
            home.js("window.TM07_OPERATOR_AUTH && window.TM07_OPERATOR_AUTH.open({});")
            modal.wait_open()
        modal.fill_and_submit(
            config.OPERATOR_LAST_NAME,
            config.OPERATOR_FIRST_NAME,
        )
        return home.wait_until(lambda: home.operator_dashboard_visible(), timeout=25)
    except Exception:
        return False


def ensure_admin(driver: WebDriver) -> bool:
    login = LoginPage(driver)
    try:
        if "/admin.html" in driver.current_url:
            if driver.find_elements(By.ID, "saveBtn"):
                return True
        login.open_login()
        login.login_admin(config.ADMIN_PASSWORD)
        return login.wait_admin_redirect()
    except Exception:
        return False


def js_async(driver: WebDriver, script: str, *args, timeout: float = 30):
    driver.set_script_timeout(timeout)
    return driver.execute_async_script(script, *args)
