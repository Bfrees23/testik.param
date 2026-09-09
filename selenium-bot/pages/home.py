"""Главная страница и модальное окно оператора."""
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

import config
from pages.base import BasePage


class HomePage(BasePage):
    def open_home(self) -> None:
        self.open("/index.html")

    def click_operator_login(self) -> None:
        if self.is_visible("benchOperatorModal") and self.has_class("benchOperatorModal", "show"):
            return
        btn = self.wait_present(By.ID, "homeLoginBtn")
        self.js("arguments[0].scrollIntoView({block:'center'}); arguments[0].click();", btn)

    def operator_dashboard_visible(self) -> bool:
        return self.is_visible("homeDashboard") and not self.has_class("homeDashboard", "d-none")

    def operator_label_text(self) -> str:
        el = self.driver.find_element(By.ID, "homeOperatorLabel")
        return (el.text or "").strip()

    def click_refresh(self) -> None:
        btn = self.wait_present(By.ID, "homeRefreshBtn")
        self.js("arguments[0].click();", btn)

    def click_logout(self) -> None:
        btn = self.wait_present(By.ID, "homeLogoutBtn")
        self.js("arguments[0].click();", btn)


class OperatorModal(BasePage):
    def wait_open(self) -> None:
        modal = self.wait_visible(By.ID, "benchOperatorModal")
        assert modal.is_displayed()

    def fill_and_submit(
        self,
        last_name: str,
        first_name: str = "",
    ) -> None:
        self.wait_open()
        last_el = self.wait_visible(By.ID, "benchOpLastName")
        last_el.clear()
        last_el.send_keys(last_name)
        first_el = self.driver.find_element(By.ID, "benchOpFirstName")
        first_el.clear()
        if first_name:
            first_el.send_keys(first_name)
        pin_el = self.driver.find_elements(By.ID, "benchOpPin")
        if pin_el and config.OPERATOR_PIN:
            pin_el[0].clear()
            pin_el[0].send_keys(config.OPERATOR_PIN)
        self.wait_clickable(By.ID, "benchOperatorModalSubmit")
        submit = self.driver.find_element(By.ID, "benchOperatorModalSubmit")
        self.js("arguments[0].click();", submit)

    def wait_success(self) -> bool:
        return self.wait_until(
            lambda: not self.is_visible("benchOperatorModal")
            or self.has_class("benchOperatorModal", "show") is False,
            timeout=20,
        )
