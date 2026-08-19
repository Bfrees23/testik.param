# Агент печати шильдиков (без BarTender)

Печать TM-07: сервер рисует шильд **Imagick** по чертежу и отдаёт **TSPL** (бинарный растр для TSC TE200). Windows-агент шлёт TSPL портом **RAW**, без драйвера и без BarTender.

## Основной путь (`engine: "raster"`, чертёж ТМР.754463.091)

1. Шаблон полей `corrector-nameplate-template.fields.json` (layout с чертежа / редактора)
2. Imagick: логотип, название, конфиг, выпуск, QR, S/N → PNG **58×20 мм @ 203 dpi**
3. PNG → TSPL `BITMAP`
4. Браузер забирает `.tspl` и шлёт агенту (`tsplBase64`)
5. Агент: **WinSpool RAW** → **TSC TE200**

Legacy (не для верстака): `engine: "html"` (Chromium), `engine: "bartender"` / `.btw`. Старый `engine: "pdf"` принимается как alias к `raster`.

## Рабочее место

1. Один раз на ПК оператора: `scripts\windows\install-print-agent.cmd`
   - копирует агент в `C:\tm07-agent`
   - ставит автозапуск при входе в Windows
   - сразу запускает агент
2. Принтер Windows: **TSC TE200** (RAW)
3. В браузере открыть верстак (`tm07-workbench.html`) с **этого же** Windows-ПК (агент слушает `127.0.0.1:18778`)
4. Печать: drawing → PNG → TSPL → агент → принтер

Если агент не запущен, в логе верстака будет подсказка с путём к `restart-print-agent.cmd`.

Проверка: http://127.0.0.1:18778/health

Опционально: задайте `TM07_PRINT_AGENT_TOKEN` в env агента и в `.env` сервера (или `printAgent.agentToken` в nameplate-config). Тогда `POST /print` требует заголовок `X-TM07-Print-Token`.

**Важно:** токен **не** отдаётся в `GET …/nameplate-print.php?action=config`. Браузер получает его только внутри print-job после входа оператора (`printAgentToken`). Агент также отклоняет TSPL без `SIZE 58 mm, 20 mm` и с командой `HOME`.

## Настройки (`data/nameplate-config.json`)

| Параметр | Значение |
|----------|----------|
| `engine` | `"raster"` (чертёж ТМР.754463.091) |
| `printAgent.format` | `"tspl"` — RAW на TSC |
| | `"png"` / `"pdf"` — через SumatraPDF / PrintTo (fallback) |
| `printAgent.printer` | `TSC TE200` |
| `printAgent.dpi` | `203` |
| `printAgent.gapMm` | `2.0` — зазор между этикетками |
| `printAgent.fallbackPreview` | `true` — если агент недоступен, открыть PNG-превью |

## API агента

`POST /print`:

```json
{
  "format": "tspl",
  "printer": "TSC TE200",
  "serial": "3002607128",
  "kind": "corrector",
  "tsplBase64": "..."
}
```

Форматы: `tspl` (RAW), `pdf`, `png`.

## Файлы на сервере

`data/nameplate-generated/3002607128-corrector.tspl` и `.png`:

```
GET /api/nameplate-print.php?action=download&file=3002607128-corrector.tspl
```

## WSL / Docker

Сервер может быть в Linux, агент — на Windows. Передаётся только TSPL (или base64).

PHP-образ: **Imagick**, **fonts-dejavu**, **TCPDF** (только для QR). Chromium нужен лишь для legacy `engine=html`.
