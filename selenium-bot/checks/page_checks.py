"""Проверки загрузки страниц и навигации."""
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

import config
import watch
from pages.base import BasePage
from reporter import Report


def run_page_checks(driver: WebDriver, report: Report) -> None:
    base = BasePage(driver)
    watch.step("UI-тесты", "загрузка страниц")

    for path, slug, by_kind, selector in config.PAGES:
        name = f"Страница {path}"
        try:
            watch.step(f"Открываю {path}")
            base.open(path)
            if not base.page_title_ok():
                report.fail(name, "Пустой или некорректный title", driver.title)
                continue
            by = By.CSS_SELECTOR if by_kind == "css" else By.ID
            el = base.wait_present(by, selector)
            watch.highlight(driver, el)
            report.ok(name, f"Загружена, якорь {selector}")
        except Exception as exc:
            report.fail(name, "Ошибка загрузки", str(exc))

    watch.step("Проверка навигации в шапке")
    base.open("/index.html")
    try:
        header = base.wait_present(By.CSS_SELECTOR, "[data-bench-header]")
        links = driver.find_elements(By.CSS_SELECTOR, ".bench-nav-link")
        hrefs = {a.get_attribute("href") for a in links}
        missing = []
        for path in config.NAV_LINKS:
            expected = f"{config.BASE_URL}{path}"
            if not any((h or "").rstrip("/") == expected.rstrip("/") for h in hrefs):
                missing.append(path)
        if missing:
            report.fail("Навигация шапки", "Не все ссылки найдены", ", ".join(missing))
        else:
            report.ok("Навигация шапки", f"{len(links)} ссылок")
    except Exception as exc:
        report.fail("Навигация шапки", str(exc))

    # Переход по разделам (прямой URL — надёжнее клика по скрытому меню в headless)
    for path in config.NAV_LINKS:
        name = f"Nav → {path}"
        try:
            watch.step(f"Переход {path}")
            driver.get(f"{config.BASE_URL}{path}")
            base.wait_until(lambda: path in driver.current_url, timeout=10)
            report.ok(name, driver.current_url)
        except Exception as exc:
            report.fail(name, str(exc))

    # Консоль после обхода
    console = base.collect_console_errors()
    if console:
        report.warn("Консоль браузера", f"{len(console)} предупреждений/ошибок", "\n".join(console[:8]))
    else:
        report.ok("Консоль браузера", "Критичных сообщений нет")
