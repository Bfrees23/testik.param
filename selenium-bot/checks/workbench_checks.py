"""Проверки рабочего места, QR и форм."""
from __future__ import annotations

from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver

import config
import watch
from helpers.session import ensure_operator
from pages.workbench import WorkbenchPage
from reporter import Report


def run_workbench_checks(driver: WebDriver, report: Report) -> None:
    watch.step("Рабочее место", "вход оператора и открытие workbench")
    if not ensure_operator(driver):
        report.skip("Workbench", "Не удалось войти как оператор")
        return

    wb = WorkbenchPage(driver)
    wb.open_workbench(new_session=True)
    watch.step("Рабочее место", "проверка блоков UI")
    wb.dismiss_operator_modal_if_present()
    wb.dismiss_guide_if_present()

    # Ключевые блоки UI
    blocks = [
        ("paramOrder1cNumber", "Поле номера заказа"),
        ("wbCorrectorCard", "Карточка сборки корректора"),
        ("wbSensorCardsHost", "Контейнер QR/S/N датчиков"),
        ("wbAssemblyConfirm", "Кнопка подтверждения сборки"),
        ("paramConnectKao", "Кнопка подключения КАО"),
        ("wbOrderSessionOpen", "Кнопка «Войти в заказ»"),
    ]
    for el_id, label in blocks:
        els = driver.find_elements(By.ID, el_id)
        if not els:
            report.fail(f"Workbench: {label}", f"#{el_id} не найден")
        elif els[0].is_displayed():
            report.ok(f"Workbench: {label}", f"#{el_id}")
        else:
            report.ok(f"Workbench: {label}", f"#{el_id} в DOM (скрыт до сборки)")

    if wb.param_section_locked():
        report.ok("Workbench: блок параметризации", "Заблокирован до сборки (ожидаемо)")
    else:
        report.warn("Workbench: блок параметризации", "Не заблокирован — возможно сборка уже подтверждена")

    # Ввод заказа
    watch.step("Рабочее место", f"ввод заказа {config.TEST_ORDER_NUMBER}")
    try:
        wb.set_order_number(config.TEST_ORDER_NUMBER)
        val = driver.find_element(By.ID, "paramOrder1cNumber").get_attribute("value")
        if val == config.TEST_ORDER_NUMBER:
            report.ok("Workbench: ввод заказа", val)
        else:
            report.fail("Workbench: ввод заказа", f"Ожидали {config.TEST_ORDER_NUMBER}, получили {val}")
    except Exception as exc:
        report.fail("Workbench: ввод заказа", str(exc))

    # Таблица параметров (JS)
    if wb.wait_param_table(min_rows=5):
        report.ok("Workbench: таблица параметров", f"{wb.param_rows_count()} строк")
    else:
        report.fail("Workbench: таблица параметров", "Мало строк или не загрузилась")

    # QR MIDA parser
    watch.step("Рабочее место", "проверка парсера QR MIDA")
    try:
        result = wb.parse_mida_qr(config.MIDA_QR_SAMPLE)
        if not result.get("ok"):
            report.fail("QR MIDA parser", result.get("error", "parse failed"), str(result))
        else:
            parsed = result.get("parsed") or {}
            checks = []
            if parsed.get("rangeMinKpa") is not None and parsed["rangeMinKpa"] < 0:
                checks.append("rangeMinKpa < 0")
            if parsed.get("rangeMaxKpa") is not None and parsed["rangeMaxKpa"] < 0:
                checks.append("rangeMaxKpa < 0")
            if parsed.get("accuracy") is not None:
                checks.append(f"accuracy={parsed.get('accuracy')}")
            detail = (
                f"type={parsed.get('sensorType')}, "
                f"min={parsed.get('rangeMinKpa')}, max={parsed.get('rangeMaxKpa')}, "
                f"acc={parsed.get('accuracy')}"
            )
            if checks and any("< 0" in c for c in checks):
                report.fail("QR MIDA parser", "Отрицательные max/min", detail)
            else:
                report.ok("QR MIDA parser", detail)
    except Exception as exc:
        report.fail("QR MIDA parser", str(exc))

    # Карточки QR/S/N — применение скана
    try:
        qr_inputs = driver.find_elements(By.CSS_SELECTOR, "#wbSensorCardsHost .wb-sensor-qr-input")
        if not qr_inputs:
            report.fail("Workbench: карточки QR/S/N", "Поля сканирования не созданы")
        else:
            qr = qr_inputs[0]
            result = driver.execute_script(
                """
                const inp = arguments[0];
                const line = arguments[1];
                if (!window.TM07_MIDA_QR || typeof window.TM07_MIDA_QR.applyScanToInputs !== 'function') {
                    return { ok: false, error: 'TM07_MIDA_QR.applyScanToInputs missing' };
                }
                return window.TM07_MIDA_QR.applyScanToInputs(line, {
                    expectKey: (inp && inp.getAttribute('data-sensor-key')) || undefined,
                });
                """,
                qr,
                config.MIDA_QR_SAMPLE,
            ) or {}
            if result.get("ok"):
                report.ok("Workbench: карточки QR/S/N", "Скан применён")
            else:
                report.fail("Workbench: карточки QR/S/N", str(result.get("error") or result))
    except Exception as exc:
        report.fail("Workbench: карточки QR/S/N", str(exc))


def run_order_page_checks(driver: WebDriver, report: Report) -> None:
    watch.step("Order 1C", "страница заказа")
    driver.get(f"{config.BASE_URL}/order-1c.html")

    fields = [
        "orderNumberInput", "orderLoadBtn", "orderStatus", "orderResultCard",
        "orderResultBody", "orderExportExcelBtn", "orderJsonPre", "orderJsonInput",
        "orderParseBtn", "orderCopyLinkBtn", "orderOdataLink",
    ]
    missing = [f for f in fields if not driver.find_elements(By.ID, f)]
    if missing:
        report.fail("Order 1C: элементы", ", ".join(missing))
    else:
        report.ok("Order 1C: элементы", f"{len(fields)} полей/кнопок")

    try:
        inp = driver.find_element(By.ID, "orderNumberInput")
        watch.highlight(driver, inp)
        inp.clear()
        inp.send_keys(config.TEST_ORDER_NUMBER.replace("ТМ00-", "").replace("TM00-", "") or "539")
        btn = driver.find_element(By.ID, "orderLoadBtn")
        watch.highlight(driver, btn, "#198754")
        btn.click()
        report.ok("Order 1C: загрузка", "клик «Загрузить»")
    except Exception as exc:
        report.fail("Order 1C: загрузка", str(exc))

    status_el = driver.find_elements(By.ID, "orderStatus")
    if status_el:
        report.ok("Order 1C: статус", (status_el[0].text or "—")[:120])

    # Ручной JSON (резервный путь без OData)
    try:
        sample = '{"value":[{"Number":"\\u0422\\u041c00-000001","Ref_Key":"test","Posted":true}]}'
        ta = driver.find_element(By.ID, "orderJsonInput")
        driver.execute_script(
            "arguments[0].value = arguments[1]; arguments[0].dispatchEvent(new Event('input',{bubbles:true}));",
            ta,
            sample,
        )
        driver.execute_script("document.getElementById('orderParseBtn')?.click();")
        body = driver.find_element(By.ID, "orderResultBody")
        rows = body.find_elements(By.TAG_NAME, "tr")
        if rows:
            report.ok("Order 1C: JSON parse", f"{len(rows)} row(s)")
        else:
            report.warn("Order 1C: JSON parse", "таблица пуста")
    except Exception as exc:
        report.fail("Order 1C: JSON parse", str(exc))

    export = driver.find_elements(By.ID, "orderExportExcelBtn")
    if export:
        report.ok("Order 1C: export", "кнопка EXP на месте")
