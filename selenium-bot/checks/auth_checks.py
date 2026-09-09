"""Авторизация оператора и страница login."""
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

import config
import watch
from pages.home import HomePage, OperatorModal
from pages.login import LoginPage
from reporter import Report


def run_auth_checks(driver: WebDriver, report: Report) -> None:
    home = HomePage(driver)
    modal = OperatorModal(driver)
    login = LoginPage(driver)

    watch.step("Auth", "оператор")
    home.open_home()

    if home.operator_dashboard_visible():
        watch.step("Auth", "оператор уже вошёл")
    else:
        watch.step("Auth", "валидация пустой формы")
        home.click_operator_login()
        try:
            modal.wait_open()
            driver.execute_script("document.getElementById('benchOperatorModalSubmit')?.click();")
            err = driver.find_element(By.ID, "benchOperatorModalError")
            if err.is_displayed() and err.text.strip():
                report.ok("Auth: валидация оператора", err.text.strip())
            else:
                report.warn("Auth: валидация оператора", "нет сообщения")
        except Exception as exc:
            report.fail("Auth: валидация оператора", str(exc))

        watch.step("Auth", "вход оператора")
        try:
            modal.fill_and_submit(
                config.OPERATOR_LAST_NAME,
                config.OPERATOR_FIRST_NAME,
            )
            if home.wait_until(lambda: home.operator_dashboard_visible(), timeout=25):
                report.ok("Auth: вход оператора", home.operator_label_text())
            else:
                report.fail("Auth: вход оператора", "dashboard hidden")
        except Exception as exc:
            report.fail("Auth: вход оператора", str(exc))

    watch.step("Auth", "login.html неверный пароль")
    login.open_login()
    try:
        login.login_admin("wrong-password-xyz")
        if login.error_visible():
            report.ok("Auth: неверный пароль admin", login.error_text() or "ошибка показана")
        elif "/admin.html" in driver.current_url:
            report.fail("Auth: неверный пароль admin", "пропустил")
        else:
            report.warn("Auth: неверный пароль admin", "нет реакции")
    except Exception as exc:
        report.fail("Auth: неверный пароль admin", str(exc))
