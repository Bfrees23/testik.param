"""Страница входа администратора."""
from __future__ import annotations

from selenium.webdriver.common.by import By

from pages.base import BasePage


class LoginPage(BasePage):
    def open_login(self) -> None:
        self.open("/login.html")

    def login_admin(self, password: str) -> None:
        pwd = self.wait_visible(By.ID, "password")
        pwd.clear()
        pwd.send_keys(password)
        self.wait_clickable(By.ID, "submitBtn").click()
        self.wait_until(
            lambda: self.error_visible() or "/admin.html" in self.driver.current_url,
            timeout=8,
        )

    def error_text(self) -> str:
        if not self.error_visible():
            return ""
        return (self.driver.find_element(By.ID, "loginError").text or "").strip()

    def wait_admin_redirect(self) -> bool:
        return self.wait_until(lambda: "/admin.html" in self.driver.current_url, timeout=20)

    def error_visible(self) -> bool:
        return self.is_visible("loginError") and not self.has_class("loginError", "d-none")
