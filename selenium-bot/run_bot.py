#!/usr/bin/env python3
"""
Selenium full-test для сайта ПК-ТМ.

Запуск:
  python run_bot.py              # полный прогон (headless)
  python run_bot.py --watch      # видимый браузер + паузы
  python run_bot.py --api-only   # только API
  python run_bot.py --skip-kao   # без KAO/COM8 (WSL/Linux)
  python run_bot.py --repeat 5   # N прогонов подряд
"""
from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass

import config
import watch
from checks.admin_checks import run_admin_checks
from checks.api_checks import run_api_checks
from checks.critical_source_checks import run_critical_source_checks
from checks.auth_checks import run_auth_checks
from checks.home_checks import run_home_checks
from checks.kao_1c_integration_checks import run_kao_1c_integration
from checks.m90_checks import run_m90_checks
from checks.navigation_checks import run_navigation_checks
from checks.parametrization_checks import run_parametrization_checks
from checks.page_checks import run_page_checks
from checks.workbench_checks import run_order_page_checks, run_workbench_checks
from checks.workbench_e2e_checks import run_workbench_e2e
from driver_factory import create_driver, stop_chrome
from reporter import Report


@dataclass
class RunOutcome:
    index: int
    ok: bool
    failed: int
    warnings: int
    passed: int
    txt_path: str | None = None
    html_path: str | None = None


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Selenium full-test ПК-ТМ")
    p.add_argument("--api-only", action="store_true", help="Только API")
    p.add_argument("--no-headless", action="store_true", help="Видимый браузер")
    p.add_argument("--watch", action="store_true", help="Видимый браузер + паузы + подсветка")
    p.add_argument("--skip-kao", action="store_true", help="Пропустить KAO/COM8 интеграцию")
    p.add_argument("--verbose", "-v", action="store_true", help="Пошаговый лог в консоль (без пауз)")
    p.add_argument("--pause", type=float, default=None, help="Пауза между шагами (сек)")
    p.add_argument(
        "--repeat",
        "-n",
        type=int,
        default=None,
        metavar="N",
        help="Сколько раз подряд запустить прогон (по умолчанию RUN_REPEAT из .env или 1)",
    )
    p.add_argument(
        "--interval",
        type=float,
        default=None,
        metavar="SEC",
        help="Пауза между прогонами, сек (REPEAT_INTERVAL в .env)",
    )
    p.add_argument(
        "--stop-on-fail",
        action="store_true",
        help="Остановиться после первого прогона с ошибками",
    )
    return p.parse_args()


def apply_run_mode(args: argparse.Namespace) -> None:
    if args.watch:
        watch.enable()
        config.HEADLESS = False
        config.KEEP_BROWSER_OPEN = True
        config.STEP_PAUSE = args.pause if args.pause is not None else 1.0
        print("Watch mode: visible browser.")
    elif args.no_headless:
        config.HEADLESS = False
    if args.pause is not None and not args.watch:
        config.STEP_PAUSE = args.pause
    if args.skip_kao:
        config.SKIP_KAO = True
    if args.verbose:
        config.VERBOSE = True
    if args.stop_on_fail:
        config.STOP_ON_FAIL = True


def run_ui_suite(driver, report: Report, skip_kao: bool = False) -> None:
    suites = [
        ("Страницы", run_page_checks),
        ("Навигация", run_navigation_checks),
        ("Auth", run_auth_checks),
        ("Home", run_home_checks),
        ("Workbench UI", run_workbench_checks),
        ("Workbench E2E", run_workbench_e2e),
        ("KAO + 1C", run_kao_1c_integration),
        ("Parametrization", run_parametrization_checks),
        ("Order 1C", run_order_page_checks),
        ("M90 bench", run_m90_checks),
        ("Admin", run_admin_checks),
    ]
    if skip_kao:
        suites = [s for s in suites if s[0] != "KAO + 1C"]
    for name, fn in suites:
        print(f"\n--- {name} ---")
        try:
            fn(driver, report)
        except Exception as exc:
            report.fail(f"Suite: {name}", str(exc))


def run_once(args: argparse.Namespace, *, run_index: int, total_runs: int) -> RunOutcome:
    skip_kao = args.skip_kao or getattr(config, "SKIP_KAO", False)
    report = Report()

    if total_runs > 1:
        print(f"\n{'=' * 50}")
        print(f"Прогон {run_index}/{total_runs}")
        print(f"{'=' * 50}")

    try:
        for name in run_critical_source_checks():
            report.ok(f"critical: {name}")
    except Exception as exc:
        report.fail("critical_source", str(exc))

    run_api_checks(report)

    if args.api_only:
        report.finish()
        txt_path, _ = report.write()
        if not config.VERBOSE:
            print(report._format_txt())
        print(f"Report: {txt_path}")
        return RunOutcome(
            index=run_index,
            ok=report.failed == 0,
            failed=report.failed,
            warnings=report.warnings,
            passed=report.passed,
            txt_path=str(txt_path),
        )

    driver = None
    try:
        driver = create_driver()
    except Exception as exc:
        report.fail("WebDriver", str(exc))
        report.finish()
        txt_path, _ = report.write()
        print(report._format_txt())
        return RunOutcome(
            index=run_index,
            ok=False,
            failed=report.failed,
            warnings=report.warnings,
            passed=report.passed,
            txt_path=str(txt_path),
        )

    is_last = run_index >= total_runs
    try:
        run_ui_suite(driver, report, skip_kao=skip_kao)
    finally:
        if watch.is_enabled() and is_last:
            watch.wait_before_close()
        if driver:
            driver.quit()
        stop_chrome()

    report.finish()
    txt_path, html_path = report.write()
    if not config.VERBOSE:
        print("\n" + report._format_txt())
    print(f"Report: {txt_path}")
    print(f"HTML:   {html_path}")
    return RunOutcome(
        index=run_index,
        ok=report.failed == 0,
        failed=report.failed,
        warnings=report.warnings,
        passed=report.passed,
        txt_path=str(txt_path),
        html_path=str(html_path),
    )


def print_repeat_summary(outcomes: list[RunOutcome]) -> None:
    if len(outcomes) <= 1:
        return
    ok_count = sum(1 for o in outcomes if o.ok)
    fail_count = len(outcomes) - ok_count
    print(f"\n{'=' * 50}")
    print(f"Итого прогонов: {len(outcomes)} · OK: {ok_count} · FAIL: {fail_count}")
    for o in outcomes:
        mark = "OK" if o.ok else f"FAIL ({o.failed})"
        print(f"  #{o.index}: {mark} — {o.passed} passed, {o.warnings} warn")
    print(f"{'=' * 50}")


def main() -> int:
    args = parse_args()
    apply_run_mode(args)

    repeat = args.repeat if args.repeat is not None else config.RUN_REPEAT
    repeat = max(1, int(repeat))
    interval = args.interval if args.interval is not None else config.REPEAT_INTERVAL

    print(f"ПК-ТМ Selenium bot (full) → {config.BASE_URL}")
    if repeat > 1:
        print(f"Repeat: {repeat} run(s), interval {interval}s")
    if watch.is_enabled():
        print(f"Pause: {config.STEP_PAUSE}s")
    elif config.VERBOSE:
        print("Verbose: live console log")
    if args.skip_kao or config.SKIP_KAO:
        print("KAO integration: skipped")
    print("=" * 50)

    outcomes: list[RunOutcome] = []
    for i in range(1, repeat + 1):
        outcome = run_once(args, run_index=i, total_runs=repeat)
        outcomes.append(outcome)
        if not outcome.ok and config.STOP_ON_FAIL:
            print(f"\n[repeat] Остановка: прогон #{i} завершился с ошибками (--stop-on-fail).")
            break
        if i < repeat and interval > 0:
            print(f"\n[repeat] Пауза {interval}s перед прогоном #{i + 1}…")
            time.sleep(interval)

    print_repeat_summary(outcomes)
    return 0 if all(o.ok for o in outcomes) else 1


if __name__ == "__main__":
    sys.exit(main())
