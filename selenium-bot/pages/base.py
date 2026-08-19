"""Базовые хелперы Selenium."""
from __future__ import annotations

import time
from typing import Callable

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

import config


class BasePage:
    def __init__(self, driver: WebDriver) -> None:
        self.driver = driver
        self.wait = WebDriverWait(driver, config.EXPLICIT_WAIT)

    def open(self, path: str = "/") -> None:
        url = path if path.startswith("http") else f"{config.BASE_URL}{path}"
        self.driver.get(url)

    def wait_visible(self, by: By, selector: str):
        return self.wait.until(EC.visibility_of_element_located((by, selector)))

    def wait_clickable(self, by: By, selector: str):
        return self.wait.until(EC.element_to_be_clickable((by, selector)))

    def wait_present(self, by: By, selector: str):
        return self.wait.until(EC.presence_of_element_located((by, selector)))

    def is_visible(self, element_id: str) -> bool:
        els = self.driver.find_elements(By.ID, element_id)
        if not els:
            return False
        return els[0].is_displayed()

    def has_class(self, element_id: str, class_name: str) -> bool:
        els = self.driver.find_elements(By.ID, element_id)
        if not els:
            return False
        return class_name in (els[0].get_attribute("class") or "").split()

    def wait_until(self, predicate: Callable[[], bool], timeout: float | None = None) -> bool:
        deadline = time.time() + (timeout or config.EXPLICIT_WAIT)
        while time.time() < deadline:
            if predicate():
                return True
            time.sleep(0.2)
        return False

    def js(self, script: str, *args):
        return self.driver.execute_script(script, *args)

    def page_title_ok(self) -> bool:
        title = (self.driver.title or "").strip()
        return bool(title) and "404" not in title.lower()

    def collect_console_errors(self) -> list[str]:
        errors: list[str] = []
        try:
            for entry in self.driver.get_log("browser"):
                level = entry.get("level", "")
                msg = entry.get("message", "")
                if level in ("SEVERE", "WARNING") and msg:
                    if "favicon" in msg.lower():
                        continue
                    errors.append(f"{level}: {msg[:500]}")
        except Exception:
            pass
        return errors
