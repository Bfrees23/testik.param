"""Рабочее место TM-07."""
from __future__ import annotations

from selenium.webdriver.common.by import By

import config
from pages.base import BasePage


class WorkbenchPage(BasePage):
    def open_workbench(self, new_session: bool = False) -> None:
        path = "/tm07-workbench.html"
        if new_session:
            path += "?newSession=1"
        self.open(path)

    def dismiss_guide_if_present(self) -> None:
        try:
            if not self.is_visible("wbGuideModal"):
                return
            if not self.has_class("wbGuideModal", "show"):
                return
            for btn_id in ("wbGuideSkip", "wbGuideAction"):
                btns = self.driver.find_elements(By.ID, btn_id)
                if btns and btns[0].is_displayed():
                    self.js("arguments[0].click();", btns[0])
                    self.wait_until(lambda: not self.has_class("wbGuideModal", "show"), timeout=5)
                    return
        except Exception:
            pass

    def dismiss_operator_modal_if_present(self) -> None:
        try:
            if self.is_visible("benchOperatorModal") and self.has_class("benchOperatorModal", "show"):
                from pages.home import OperatorModal

                OperatorModal(self.driver).fill_and_submit(
                    config.OPERATOR_LAST_NAME,
                    config.OPERATOR_FIRST_NAME,
                )
        except Exception:
            pass

    def set_order_number(self, order: str) -> None:
        inp = self.wait_present(By.ID, "paramOrder1cNumber")
        self.js(
            "arguments[0].value = arguments[1]; arguments[0].dispatchEvent(new Event('input', {bubbles:true}));",
            inp,
            order,
        )

    def click_open_session(self) -> None:
        self.wait_clickable(By.ID, "wbOrderSessionOpen").click()

    def assembly_card_present(self) -> bool:
        return self.is_visible("wbCorrectorCard")

    def param_section_locked(self) -> bool:
        el = self.driver.find_elements(By.ID, "wbParamSection")
        if not el:
            return False
        classes = el[0].get_attribute("class") or ""
        return "wb-param-locked" in classes

    def qr_input_present(self) -> bool:
        return self.is_visible("paramQrSensor")

    def parse_mida_qr(self, line: str) -> dict:
        script = """
        const line = arguments[0];
        if (!window.TM07_MIDA_QR || !window.TM07_MIDA_QR.parseMidaQrLine) {
            return { ok: false, error: 'TM07_MIDA_QR not loaded' };
        }
        return window.TM07_MIDA_QR.parseMidaQrLine(line);
        """
        return self.js(script, line) or {}

    def param_rows_count(self) -> int:
        rows = self.driver.find_elements(By.CSS_SELECTOR, "#paramTbody tr")
        return len(rows)

    def wait_param_table(self, min_rows: int = 5) -> bool:
        return self.wait_until(lambda: self.param_rows_count() >= min_rows, timeout=25)
