# Агент рабочего места Senselock (свисток)

## Скачать

**/admin.html** → «Рабочие места» → **Скачать агент Senselock (.cmd)** → двойной клик.

## Что читается

| Уровень | Данные |
|---------|--------|
| Windows PnP/USB | имя, ContainerId, InstanceId, реестр USB — всегда |
| **Sense4.dll** (Elite4 SDK) | HUSN, тип, свободное место, customer/developer ID, дата изготовления, часы, проверка user PIN, лицензии (если есть) |
| Файлы на чипе (DATA/EXE) | **нельзя** прочитать как файлы с ПК — только через `S4Execute` и известные file ID |

Положите `Sense4.dll` рядом с агентом (`%LOCALAPPDATA%\TM07\senselock-agent`). Архитектура DLL = PowerShell (обычно x64).

Опционально:

```bat
set TM07_SENSE4_DLL=C:\path\Sense4.dll
set TM07_SENSE4_USER_PIN=12345678
```

В консоли при старте печатается полный дамп; в JSON — `keyDump` (`/status` или `/dump`).

## Проверка

```bat
curl http://127.0.0.1:18779/status
```

Версия агента: **10+**.
