"""Сбор результатов проверок и отчёт в txt + html."""
from __future__ import annotations

import html
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Literal

import config

Status = Literal["pass", "fail", "warn", "skip"]


@dataclass
class CheckResult:
    name: str
    status: Status
    message: str
    detail: str = ""


@dataclass
class Report:
    started_at: datetime = field(default_factory=datetime.now)
    finished_at: datetime | None = None
    results: list[CheckResult] = field(default_factory=list)

    def add(self, name: str, status: Status, message: str, detail: str = "") -> None:
        self.results.append(CheckResult(name, status, message, detail))

    def ok(self, name: str, message: str = "OK", detail: str = "") -> None:
        self.add(name, "pass", message, detail)
        self._print_live("✓", name, message)

    def fail(self, name: str, message: str, detail: str = "") -> None:
        self.add(name, "fail", message, detail)
        self._print_live("✗", name, message, detail)

    def warn(self, name: str, message: str, detail: str = "") -> None:
        self.add(name, "warn", message, detail)
        self._print_live("!", name, message, detail)

    def skip(self, name: str, message: str, detail: str = "") -> None:
        self.add(name, "skip", message, detail)
        self._print_live("−", name, message)

    def _print_live(self, icon: str, name: str, message: str, detail: str = "") -> None:
        if not config.VERBOSE:
            return
        line = f"[{icon}] {name}: {message}"
        if detail:
            line += f" ({detail[:120]})"
        print(line, flush=True)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.status == "pass")

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if r.status == "fail")

    @property
    def warnings(self) -> int:
        return sum(1 for r in self.results if r.status == "warn")

    def finish(self) -> None:
        self.finished_at = datetime.now()

    def write(self) -> tuple[Path, Path]:
        config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
        ts = self.started_at.strftime("%Y-%m-%d_%H-%M-%S")
        txt_path = config.REPORTS_DIR / f"report-{ts}.txt"
        html_path = config.REPORTS_DIR / f"report-{ts}.html"
        latest_txt = config.REPORTS_DIR / "report-latest.txt"
        latest_html = config.REPORTS_DIR / "report-latest.html"

        txt_body = self._format_txt()
        html_body = self._format_html()

        txt_path.write_text(txt_body, encoding="utf-8")
        html_path.write_text(html_body, encoding="utf-8")
        latest_txt.write_text(txt_body, encoding="utf-8")
        latest_html.write_text(html_body, encoding="utf-8")

        meta = {
            "startedAt": self.started_at.isoformat(),
            "finishedAt": (self.finished_at or datetime.now()).isoformat(),
            "passed": self.passed,
            "failed": self.failed,
            "warnings": self.warnings,
            "results": [
                {"name": r.name, "status": r.status, "message": r.message, "detail": r.detail}
                for r in self.results
            ],
        }
        (config.REPORTS_DIR / f"report-{ts}.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return txt_path, html_path

    def _format_txt(self) -> str:
        lines = [
            "ПК-ТМ · Selenium smoke-test",
            f"Старт: {self.started_at.strftime('%Y-%m-%d %H:%M:%S')}",
            f"URL: {config.BASE_URL}",
            "",
        ]
        for r in self.results:
            icon = {"pass": "✓", "fail": "✗", "warn": "!", "skip": "−"}.get(r.status, "?")
            lines.append(f"[{icon}] {r.name}: {r.message}")
            if r.detail:
                lines.append(f"    {r.detail}")
        lines.extend(
            [
                "",
                f"Итого: {self.passed} OK, {self.failed} FAIL, {self.warnings} WARN",
            ]
        )
        return "\n".join(lines) + "\n"

    def _format_html(self) -> str:
        rows = []
        for r in self.results:
            cls = r.status
            rows.append(
                "<tr class='{cls}'>"
                "<td>{name}</td><td>{status}</td>"
                "<td>{msg}</td><td><pre>{det}</pre></td></tr>".format(
                    cls=cls,
                    name=html.escape(r.name),
                    status=html.escape(r.status),
                    msg=html.escape(r.message),
                    det=html.escape(r.detail),
                )
            )
        return f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>Selenium report · ПК-ТМ</title>
<style>
body{{font-family:system-ui,sans-serif;margin:1.5rem;background:#f8f9fa}}
table{{border-collapse:collapse;width:100%;background:#fff;box-shadow:0 1px 3px #0001}}
th,td{{border:1px solid #dee2e6;padding:.5rem .75rem;text-align:left;vertical-align:top}}
th{{background:#212529;color:#fff}}
tr.pass td:nth-child(2){{color:#198754;font-weight:600}}
tr.fail td:nth-child(2){{color:#dc3545;font-weight:600}}
tr.warn td:nth-child(2){{color:#fd7e14;font-weight:600}}
pre{{margin:0;white-space:pre-wrap;font-size:.85rem}}
.summary{{margin-bottom:1rem;padding:1rem;background:#fff;border-radius:.5rem}}
</style></head><body>
<h1>ПК-ТМ · Selenium smoke-test</h1>
<div class="summary">
<p><strong>URL:</strong> {html.escape(config.BASE_URL)}</p>
<p><strong>Результат:</strong> {self.passed} OK · {self.failed} FAIL · {self.warnings} WARN</p>
</div>
<table><thead><tr><th>Проверка</th><th>Статус</th><th>Сообщение</th><th>Детали</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table></body></html>"""
