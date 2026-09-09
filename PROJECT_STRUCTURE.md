# ТМ-07: структура проекта и базы данных

Веб-стенд **ПК-ТМ** — калибровка корректора и параметризация по заказу 1С.
Стек: PHP (php-fpm) + чистый JS + PostgreSQL, деплой в Docker Compose.

---

## 1. Общая структура каталогов

```
LAST VERSION/
├── .github/workflows/ci.yml      # CI: поднимает Docker, гоняет selenium-bot --api-only
├── data/                         # Данные вне src (шаблоны шильдов, шрифты, превью)
│   └── nameplate-templates/      #   .btw, .png, шрифты, orig-preview (PDF/PNG)
├── database/                     # Схемы БД и миграции
│   ├── schema.postgres.sql       #   основная схема (PostgreSQL 16+)
│   ├── schema.firebird.sql       #   legacy-схема Firebird
│   ├── schema.firebird25.sql
│   ├── schema.firebird.ibexpert.sql
│   ├── bpek_tm07_*.ibexpert.sql  #   схемы/подготовка для IBExpert
│   ├── drop_tm07_tables.sql
│   ├── test_connection.sql
│   ├── install_schema.cmd
│   └── install_bpek_bench.cmd
├── docker/                       # Образы и конфиги контейнеров
│   ├── nginx/                    #   dev.Dockerfile, conf.d/, ssl/, gen-dev-cert.sh
│   ├── php/                      #   dev.Dockerfile, composer.json, conf.d/ (php.ini, xdebug, opcache)
│   └── firebird/                 #   install-schema.sh, README
├── docker-compose.yml            # nginx + php + gotenberg + postgres (+ firebird)
├── firmware/                     # Прошивки корректора (.bin) + README
├── scripts/                      # DevOps/утилиты
│   ├── sync-public-js.sh         #   parametrization/js → public/js
│   ├── sync-serial-xlsx.{sh,ps1} #   синхронизация реестра S/N с сетевой шары
│   ├── check-critical-invariants.sh
│   ├── ensure-lan-access.{sh,ps1}
│   └── windows/                  #   print-агенты (Bartender/PDF), установка
├── selenium-bot/                 # Smoke/regression тесты (Python + Selenium)
│   ├── run_bot.py, watch.py, config.py, driver_factory.py, reporter.py
│   ├── checks/                   #   admin, api, auth, home, m90, workbench, ...
│   ├── pages/                    #   Page Objects (base, home, login, workbench)
│   ├── helpers/                  #   kao_odata, session
│   ├── fixtures/                 #   sample_order
│   └── tests/                    #   test_smoke.py
├── src/                          # Исходники приложения (см. раздел 2)
├── .env.example                  # Шаблон переменных окружения
├── README.md
└── PROJECT_STRUCTURE.md          # этот файл
```

---

## 2. Структура `src/`

```
src/
├── public/                       # КОРЕНЬ САЙТА (отдаёт nginx)
│   ├── index.html                #   главная
│   ├── login.html                #   вход оператора
│   ├── admin.html                #   админка (профили COM, настройки)
│   ├── tm07-workbench.html       #   рабочее место (заказ 1С, QR)
│   ├── order-1c.html             #   загрузка заказа OData
│   ├── tm07-parametrization-kao.html
│   ├── tm07-parametrization-kao-counters.html
│   ├── nameplate-template-editor.html
│   ├── btw-viewer.html
│   ├── test-process-m90-15c.html
│   ├── css/                      #   bench-pages.css, nameplate-template-editor.css
│   ├── js/                       #   скомпилированные/синхронизированные скрипты
│   │   ├── site-*.js             #     shell, nav-auth, operator-auth, settings-cache, ...
│   │   ├── admin-panel.js, btw-viewer.js
│   │   ├── korrektor-device.js, korrektor-panel.js
│   │   ├── calibration/          #     m90-device, pkd160-panel, serial-direct, ...
│   │   ├── parametrization/      #     tm07-workbench*, tm07-counters, tm07-serial-registry, ...
│   │   ├── parametrization-kao/  #     tm07-parametrization-kao.js
│   │   └── vendor/               #     qrcode.min.js
│   ├── maps/                     #   .prm карты параметризации/калибровки
│   ├── fonts/                    #   DejaVu, nameplate/LiberationSans
│   ├── vendor/                   #   bootstrap, bootstrap-icons
│   └── favicon.svg
│
├── api/                          # PHP API (точки входа)
│   ├── db_bench.php              #   ядро БД (PDO, ensure-create таблиц)
│   ├── auth.php, auth_common.php #   аутентификация оператора/админа
│   ├── bench-db-status.php       #   статус БД, операторы, сессии
│   ├── bench_context.php         #   контекст рабочего места
│   ├── bench-events.php          #   журнал событий производства
│   ├── bench-cycle-progress.php  #   ход цикла параметризации/калибровки
│   ├── bench-notify.php
│   ├── tm07-serial-registry.php  #   реестр S/N
│   ├── tm07-sensor-bind.php      #   привязка датчиков
│   ├── tm07-firmware.php         #   прошивки
│   ├── odata-1c.php              #   прокси → 1С (OData)
│   ├── counters.php              #   счётчики (Google-таблица)
│   ├── nameplate-print.php       #   печать шильдика
│   ├── nameplate-template.php    #   шаблоны шильдов
│   ├── passport-generate.php     #   формирование паспорта
│   ├── admin-settings.php        #   настройки админки
│   ├── admin-db-browse.php       #   просмотр БД
│   ├── admin-ops.php
│   ├── site-action-log.php       #   журнал действий (txt)
│   ├── btw-inspect.php
│   ├── senselock-agent-download.php
│   ├── cli-close-stale-sessions.php  #   CLI: закрытие зависших сессий
│   ├── cli-health.php            #   CLI: healthcheck
│   ├── check_ops.php
│   └── lib/                      #   переиспользуемые модули
│       ├── site_file_log.php     #     файловый лог
│       ├── serial_xlsx.php       #     реестр S/N из XLSX
│       ├── btw_parser.php        #     парсер .btw
│       ├── nameplate_*.php       #     печать: pdf, tspl, gotenberg, html_raster, print, ...
│       ├── nameplate_corrector_config.php
│       ├── nameplate_template_editor.php
│       ├── nameplate_reference_drawing.php
│       └── passport_docx.php     #     паспорт в DOCX
│
├── calibration/                  # Исходники калибровки
│   ├── pages/                    #   test-process-m90-15c.html, README
│   ├── js/                       #   m90-device, pkd160-panel, serial-direct, test-process
│   └── maps/                     #   tm07-map-v28.prm
│
├── parametrization/              # Исходники параметризации
│   ├── pages/                    #   tm07-workbench, order-1c, kao-counters, README
│   ├── js/                       #   tm07-workbench*, tm07-counters, tm07-serial-registry, ...
│   ├── kao/                      #   js/ + pages/ (параметризация KAO)
│   └── maps/                     #   tm07-parametrization-v50.prm
│
├── tm07-common/js/               # Общий JS (Modbus-устройство)
│   ├── korrektor-device.js
│   └── korrektor-panel.js
│
├── config/                       # Конфигурация PHP
│   ├── environment.php           #   загрузка .env
│   ├── config.php                #   константы, таймауты, логи
│   └── defaults/                 #   device_settings.json, nameplate-config.json
│
├── data/                         # device_settings.json (рабочие данные)
├── logs/                         # текстовые логи (.gitkeep)
├── scripts/                      # PHP-утилиты (btw-extract-label, build-nameplate-*)
├── vendor/                       # Composer: setasign/fpdi, tecnickcom/tcpdf
└── composer.json / composer.lock
```

> **Важно про JS:** редактируются исходники в `calibration/js/`, `parametrization/js/`, `tm07-common/js/`, затем `scripts/sync-public-js.sh` копирует их в `src/public/js/`. Nginx отдаёт только `src/public/`.

---

## 3. База данных

### 3.1 Движок и подключение

- **PostgreSQL 16+** — основной движок (Docker-сервис `postgres`, БД `tm07`).
- **Firebird** — legacy/миграция (`TM07_DB_DRIVER=firebird`), схемы в `database/schema.firebird*.sql`.
- Переключение драйвера — переменная `TM07_DB_DRIVER` в `.env`.
- Подключение в PHP через **PDO** (`src/api/db_bench.php`), `ATTR_CASE=UPPER`; идентификаторы хранятся в нижнем регистре.
- Схема создаётся из `database/schema.postgres.sql` (docker init) и дополнительно «ensure-create» из PHP.

### 3.2 Таблицы

| Таблица | Назначение | Ключевые поля / связи |
|---|---|---|
| `tm07_workstation` | Рабочие места (ПК) стенда | `code` (UNIQUE), `hostname`, `client_fingerprint`, `config_json`, `is_active` |
| `tm07_operator` | Операторы | `login` (UNIQUE), `display_name`, `last_name`/`first_name`, `pin_hash`, `is_active` |
| `tm07_event_type` | Справочник типов событий | `code` (UNIQUE), `name`, `stage` — 16 предзаданных значений |
| `tm07_serial_counter` | Счётчики серийных номеров | составной PK `(prefix, month_key)`, `last_seq` |
| `tm07_serial_issued` | Выданные S/N корректора/комплекса | `serial` (UNIQUE `CHAR(10)`), `kind`, `prefix`, `month_key`, `seq`, FK → `operator`, `workstation`, `order_number`, `payload` |
| `tm07_bench_event` | Журнал событий производства | FK → `event_type`, `operator`, `workstation`; `serial_corrector`/`serial_complex`, `stage`, `payload` |
| `tm07_bench_session` | Сессии заказов | `order_number`, `state` (`active/closed`), `session_stage`, `serial_corrector`, `assembly_confirmed_at`, `opened_at`/`closed_at`, FK → `operator`, `workstation` |
| `tm07_cycle_progress` | Ход цикла параметризации/калибровки | `serial_number` (PK), `phase_states` (JSON), `next_phase_index`, `cycle_status`, `report_summary` |
| `tm07_corrector_sensor` | Привязка датчиков (DA/DT/DD/TT) к корректору | `serial_corrector`, `channel`, `sensor_serial` (UNIQUE), `qr_raw`, FK → `session`, `operator`, `workstation`; `CHECK` на канал |

### 3.3 Связи (схема)

```
tm07_operator ──┬──< tm07_serial_issued
                ├──< tm07_bench_event
                ├──< tm07_bench_session
                └──< tm07_corrector_sensor

tm07_workstation ─┬──< tm07_serial_issued
                  ├──< tm07_bench_event
                  ├──< tm07_bench_session
                  └──< tm07_corrector_sensor

tm07_event_type ──< tm07_bench_event
tm07_bench_session ──< tm07_corrector_sensor (session_id)
```

### 3.4 Предзаданные типы событий (`tm07_event_type`)

| code | name | stage |
|---|---|---|
| `operator_login` | Вход оператора | auth |
| `workstation_register` | Регистрация рабочего места (ПК) | auth |
| `order_session_open` | Открытие сессии заказа | order |
| `order_session_close` | Закрытие сессии заказа | order |
| `assembly_confirm` | Подтверждение сборки корректора | assembly |
| `serial_corrector` | Выдача S/N корректора | serial |
| `serial_complex` | Выдача S/N комплекса | serial |
| `nameplate_print` | Печать шильдика | serial |
| `sensor_bind` | Привязка датчика к корректору | parametrization |
| `parametrization_start` | Начало параметризации | parametrization |
| `parametrization_verify` | Сверка после записи | parametrization |
| `parametrization_done` | Параметризация завершена | parametrization |
| `passport_generate` | Формирование паспорта | parametrization |
| `calibration_start` | Начало калибровки | calibration |
| `calibration_done` | Калибровка завершена | calibration |
| `calibration_phase` | Этап калибровки | calibration |

---

## 4. Архитектура (поток данных)

```
┌─ Браузер (Chrome/Edge) ─────────────────────────────┐
│  Web Serial API → COM/USB (КАО) ──→ корректор (Modbus)│
│  localStorage: state, order cache, WS-fingerprint     │
│  страницы: index, login, admin, tm07-workbench,       │
│  order-1c, parametrization-kao(-counters),            │
│  nameplate-template-editor, btw-viewer                │
└───────────────┬──────────────────────────────────────┘
                │ HTTP :8081 / HTTPS :8443
┌───────────────▼──────────────────────────────────────┐
│  Nginx (отдаёт только src/public/)                   │
└───────────────┬──────────────────────────────────────┘
                │ php-fpm
┌───────────────▼──────────────────────────────────────┐
│  PHP API  (src/api/*.php)                            │
│  • db_bench.php — ядро БД (PDO)                      │
│  • bench-db-status / bench_context — оператор/сессии  │
│  • tm07-serial-registry — S/N                        │
│  • bench-events / bench-cycle-progress               │
│  • odata-1c — прокси → 1С (OData)                    │
│  • nameplate-print + lib/ (PDF/TSPL/Gotenberg)       │
│  • tm07-sensor-bind, passport-generate               │
│  • site-action-log — журнал (txt)                    │
└──────┬──────────────┬──────────────┬─────────────────┘
       │              │              │
┌──────▼─────┐  ┌─────▼──────┐  ┌────▼──────────┐
│ postgres   │  │ gotenberg  │  │ 1С (OData)    │
│ tm07       │  │ PDF-рендер │  │ заказы        │
└────────────┘  └────────────┘  └───────────────┘
```

**Внешние интеграции**
- **1С** — заказы через OData (прокси `odata-1c.php`, параметры в `.env`).
- **Google Таблица** — страница «Параметризация — счётчики» (опционально).
- **Сеть/AD** — UNC-реестр S/N корректоров на `srv-fs`, синхронизация в XLSX.
- **Печать** — локальные Windows-агенты (Bartender/PDF, TSPL) для шильдов.

**Инфраструктура (docker-compose.yml)**
- `nginx` — статика + HTTPS, порты `8081:80` и `8443:443` (Web Serial по LAN).
- `php` (php-fpm) — API; healthcheck; при старте закрывает зависшие сессии.
- `gotenberg` — конвертация в PDF для шильдов.
- `postgres` — БД; инициализация из `database/schema.postgres.sql`.

**Качество** — `selenium-bot/` (smoke/regression API и UI), CI в `.github/workflows/ci.yml`.
