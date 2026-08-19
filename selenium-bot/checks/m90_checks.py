# M90 calibration bench smoke UI tests.
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

import config
import watch
from pages.base import BasePage
from reporter import Report


def run_m90_checks(driver: WebDriver, report: Report) -> None:
    watch.step("M90", "calibration page")
    base = BasePage(driver)
    driver.get(f"{config.BASE_URL}/test-process-m90-15c.html")
    base.wait_present(By.CSS_SELECTOR, "[data-bench-header]")

    groups = {
        "M90: USB": ["channelsList", "autoReconnectToggleBtn"],
        "M90: PKD": ["pkdConnectBtn", "pkdDisconnectBtn", "pkdReadBtn", "pkdArmState"],
        "M90: corrector": ["corrConnectBtn", "corrDisconnectBtn", "corrReadBtn", "corrWriteBtn", "corrStatus"],
        "M90: scenario": ["runFullBtn", "resumeScenarioBtn", "stopScenarioBtn", "phaseAccordion"],
        "M90: settings": ["benchMitChannel", "saveBenchSettingsBtn", "benchCorrSerialInput"],
        "M90: log": ["log", "exportLogBtn", "clearLogBtn", "cycleReport"],
        "M90: operator overlay": ["proceedOverlay", "proceedBtn"],
    }
    for name, ids in groups.items():
        missing = [i for i in ids if not driver.find_elements(By.ID, i)]
        if missing:
            report.fail(name, "missing", ", ".join(missing))
        else:
            report.ok(name, f"{len(ids)} elements")

    badges = driver.find_elements(By.CSS_SELECTOR, "[id^='badge_']")
    report.ok("M90: phase badges", f"{len(badges)} badge(s)")

    try:
        phases = driver.find_elements(By.CSS_SELECTOR, "[data-run-phase], .accordion-button")
        if phases:
            driver.execute_script("arguments[0].click();", phases[0])
            report.ok("M90: accordion", "first panel opened")
    except Exception as exc:
        report.warn("M90: accordion", str(exc))

    run_btn = driver.find_element(By.ID, "runFullBtn")
    report.ok("M90: runFullBtn", "disabled" if not run_btn.is_enabled() else "enabled")

    try:
        driver.execute_script("document.getElementById('saveBenchSettingsBtn')?.click();")
        report.ok("M90: save settings", "click OK")
    except Exception as exc:
        report.fail("M90: save settings", str(exc))
