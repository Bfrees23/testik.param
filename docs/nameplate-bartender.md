# Печать шильда через BarTender-агент (.btw → TSC TE200)

## Требования (Windows, ПК оператора)

1. **BarTender Automation** (2016+, не UltraLite).
2. Принтер **TSC TE200** в Windows (имя как в конфиге).
3. Шаблон `.btw` 58×20 мм в `data/nameplate-templates/` (по умолчанию `corrector-300.btw`).
4. В BarTender Designer — именованные поля: `Serial`, `OrderNumber`, `ProductTitle`, `ConfigText`, `ReleaseLabel` и т.д.

## Запуск агента

```cmd
cd "LAST VERSION\scripts\windows"
start-bartender-agent.cmd
```

Агент: `http://127.0.0.1:18777`

Проверка:

```text
GET http://127.0.0.1:18777/health
```

## Конфиг `data/nameplate-config.json`

| Поле | Значение |
|------|----------|
| `engine` | `bartender` |
| `bartender.agentUrl` | `http://127.0.0.1:18777` |
| `bartender.templateCorrector` | имя `.btw` |
| `bartender.printer` | `TSC TE200` |
| `bartender.directPrint` | `true` — печать через агент |
| `bartender.fallbackPdf` | `true` — если агент недоступен, открыть PDF |
| `bartender.saveCopy` | `true` — сохранять заполненный `.btw` в `nameplate-generated/` |

## Как работает

1. Сайт собирает поля (S/N, заказ, конфигурация).
2. Браузер вызывает `POST /print` на локальном агенте.
3. Агент через BarTender COM: открывает `.btw` → подставляет поля → печатает на TSC TE200.
4. Копия заполненного `.btw` сохраняется в `data/nameplate-generated/`.

## API агента

| Метод | Описание |
|-------|----------|
| `GET /health` | статус агента и BarTender COM |
| `POST /print` | заполнить + напечатать |
| `POST /print-filled` | то же, что `/print` |
| `POST /generate-btw` | только заполнить и вернуть base64 |
| `GET /list-fields?template=…` | список полей шаблона |

Пример печати:

```bash
curl -X POST http://127.0.0.1:18777/print \
  -H "Content-Type: application/json" \
  -d '{
    "serial": "3002607128",
    "template": "corrector-300.btw",
    "printer": "TSC TE200",
    "saveCopy": true,
    "fields": {
      "Serial": "3002607128",
      "ReleaseLabel": "Выпуск 07.2026"
    }
  }'
```

## Свой шаблон

Скопируйте `.btw` в `data/nameplate-templates/` и укажите имя в `bartender.templateCorrector`.

Имена полей в Designer должны совпадать с `fieldSerial`, `fieldConfigText` и т.д. в конфиге.
