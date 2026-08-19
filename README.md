# ТМ-07: калибровка и параметризация

Веб-стенд **ПК-ТМ** — калибровка корректора и параметризация по заказу 1С.

## Страницы

| URL | Назначение |
|-----|------------|
| `/index.html` | Главная |
| `/tm07-parametrization-kao.html` | Параметризация — карта 50 |
| `/tm07-workbench.html` | Рабочее место (заказ 1С, QR) |
| `/tm07-parametrization-kao-counters.html` | Параметризация со счётчиками |
| `/order-1c.html` | Загрузка заказа OData |
| `/admin.html` | Профили COM (VID/PID, baud) |

## Структура

```
src/
├── public/               # Корень сайта (отдаёт nginx)
├── calibration/          # Калибровка: pages/, js/, maps/
├── parametrization/      # Параметризация (+ kao/)
├── tm07-common/js/       # Modbus (korrektor-device)
├── api/                  # PHP API
└── config/, data/

scripts/
├── sync-public-js.sh     # parametrization/js → public/js
└── (cli) php src/api/cli-close-stale-sessions.php  # закрытие зависших сессий
```

**JS:** редактируйте `parametrization/js/`, `calibration/js/`, `tm07-common/js/`, затем:

```bash
./scripts/sync-public-js.sh          # синхронизировать
./scripts/sync-public-js.sh --check  # проверить без записи (CI)
```

Nginx отдаёт только `src/public/`.

**Кэш настроек:** `site-settings-cache.js` — `sessionStorage`, 5 мин для `admin-settings/public` и `odata-1c/config`. Сбрасывается при сохранении в админке.

### Selenium-bot (smoke / regression)

```bash
cd selenium-bot
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python run_bot.py --api-only      # API (~20 проверок)
python run_bot.py --skip-kao      # полный UI без COM8
python run_bot.py --watch         # видимый браузер + KAO
```

CI: GitHub Actions job `api-tests` поднимает Docker и гоняет `run_bot.py --api-only`.

## Запуск

**Docker (с PHP API, OData 1С):**

```bash
cp .env.example .env   # при необходимости
docker compose up -d --build
```

Откройте: **http://localhost:8081** (на этом ПК) или **https://IP-СЕРВЕРА:8443** (с других ПК в сети — нужен HTTPS для Web Serial).

### Web Serial по локальной сети

Браузер разрешает USB/COM только в **secure context**: `localhost`, `127.0.0.1` или **HTTPS**.

| Откуда | URL |
|--------|-----|
| Этот ПК | http://localhost:8081 |
| Другой ПК в LAN | **https://IP-СЕРВЕРА:8443** (подставьте IP сервера) |

**USB-адаптер должен быть подключён к тому же ПК, где открыт браузер** — Web Serial работает локально на клиенте, не на сервере.

#### Доверенный HTTPS (замок «Защищено» без предупреждений)

На сервере один раз выпустите сертификат:

```bash
./docker/nginx/gen-dev-cert.sh
docker compose up -d nginx
```

На **каждом рабочем ПК** (Windows) установите корневой CA **от имени администратора**:

```text
docker\nginx\install-root-ca-windows.cmd
```

Или скачайте CA с сайта (после однократного «Перейти на сайт»):  
`https://IP-СЕРВЕРА:8443/bench-ca.crt` → двойной щелчок → «Установить сертификат» → «Локальный компьютер» → «Доверенные корневые центры сертификации».

После установки CA перезапустите Chrome/Edge — соединение будет **защищённым** без жёлтых предупреждений.

Если сменился IP сервера: `./docker/nginx/gen-dev-cert.sh НОВЫЙ_IP` и снова `docker compose up -d nginx`.

### Сохранение работы при обновлении (F5)

Состояние рабочего места автоматически сохраняется в **localStorage** браузера:

- номер заказа и кэш 1С;
- все поля параметров (`val_*`);
- отсканированные QR датчиков;
- S/N счётчика, Modbus-адрес и скорость;
- журнал (последние строки).

После **F5** или закрытия вкладки данные подставляются обратно. **КАО** переподключается автоматически, если USB не отключали и порт уже был разрешён в Chrome/Edge (без повторного выбора в диалоге).

Данные привязаны к origin браузера (`https://IP:8443`) и не переносятся на другой ПК автоматически.

## Заказ 1С (OData)

Цепочка: `/order-1c.html` или **Рабочее место** → `order-1c-odata.js` → `/api/odata-1c.php` → 1С `Document_ЗаказНаПроизводство2_2` → `sessionStorage` `order1c_param_lastOrder` → `tm07-order1c-to-param.js`.

В `.env` (см. `.env.example`):

```env
ODATA_1C_HOST_IP=
ODATA_1C_HTTP_HOST=
ODATA_1C_USER=...
ODATA_1C_PASSWORD=...
```

База по умолчанию: `` (PHP подставляет IP и заголовок Host).

Проверка: `GET /api/odata-1c.php?action=config` или DevTools → Network → `X-OData-Request-URL` в ответе прокси.

## Локальная БД (Firebird / SQLite)

Журнал серийных номеров, событий калибровки/параметризации, оператора и рабочего места.

| Режим | Когда |
|-------|--------|
| **Firebird** | `` в `.env`, схема из `database/` (см. ниже) |
| **SQLite** | Fallback: `` (создаётся автоматически) |

### Установка схемы Firebird

**По умолчанию (Docker):** при `docker compose up -d` поднимается сервис `firebird`, база `tm07_bench.fdb` и схема из `database/schema.firebird.sql` создаются автоматически. В `.env`:

```env
FIREBIRD_HOST=firebird
FIREBIRD_DATABASE=/firebird/data/tm07_bench.fdb
```

Проверка: `` → `"driver":"firebird"`.

Сброс БД: ``

**Windows / IBExpert (опционально):** см. `` — без `COMMIT;` в SQL-скриптах.

### API

| Endpoint | Назначение |
|----------|------------|
| `POST /api/tm07-serial-registry.php` | `{ action: allocate\|peek, kind: corrector\|complex }` — S/N 300/400 |
| `GET /api/bench-db-status.php?action=status` | Драйвер БД, оператор, рабочее место, активная сессия |
| `GET /api/bench-db-status.php?action=sessions` | Список сессий заказов с статусом параметризации |
| `POST /api/bench-db-status.php` | `{ action: selectOperator, login, lastName, firstName? }` — вход оператора |
| `POST /api/bench-db-status.php` | `{ action: selectOrder, orderNumber, orderStatus?, orderPayload? }` — **сессия заказа** |
| `POST /api/bench-db-status.php` | `{ action: clearOrder }` — закрыть сессию заказа |
| `POST /api/bench-db-status.php` | `{ action: deleteSession, sessionId }` — **удалить сессию (только админ)** |
| `POST /api/bench-db-status.php` | `{ action: registerWorkstation, fingerprint, clientConfig }` — конфигурация ПК |
| `GET /api/bench-events.php?action=last` | Журнал событий |
| `POST /api/bench-events.php` | `{ action: log, eventType, serialCorrector?, stage? }` |
| `POST /api/nameplate-print.php` | `{ kind: corrector\|complex, serial, productTitle?, orderNumber? }` — PDF/TSPL задание печати шильдика |
| `GET /nameplate-template-editor.html` | Визуальный редактор шаблона шильда (слои, эталон, авто-превью PDF) |

Типы событий: `operator_login`, `workstation_register`, `order_session_open/close`, `serial_corrector`, `serial_complex`, `nameplate_print`, `parametrization_start/done`, `calibration_start/done/phase`.

**Шильдик:** при открытии заказа автоматически выдаётся S/N корректора (300…) и формируется задание печати. Основной движок: `data/nameplate-config.json` → `"engine": "pdf"` + локальный Windows-агент TSPL на `http://127.0.0.1:18778` (см. `docs/nameplate-print-agent.md`). Редактор шаблона: `/nameplate-template-editor.html`. Для legacy HTML-превью можно включить `"engine": "html"`; для BarTender — `"engine": "bartender"`.

**Оператор:** кнопка **Оператор** в шапке — **фамилия** (обязательно) и имя. Без входа параметризация на рабочем месте блокируется.

**Сессия заказа:** работа с корректором привязана к заказу. На **главной** — вход оператора и таблица сессий. **«Новая сессия»** или смена номера заказа сбрасывает QR, S/N, поля и отключает КАО. **Администратор** может удалять сессии. На рабочем месте: войти в заказ → сгенерировать S/N и **распечатать шильдик** → подтвердить сборку → КАО → параметризация.

**Рабочее место:** при загрузке страницы браузер отправляет конфигурацию ПК (ОС, браузер, экран, timezone) — сохраняется в `TM07_WORKSTATION`. **Идентификатор** — fingerprint в `localStorage` (`WS…`), свой на каждый ПК/браузер. Сессии заказов и события привязаны к этому ID. Переменные `TM07_WORKSTATION_CODE` / `TM07_WORKSTATION_NAME` в `.env` — только для одного серверного стенда без LAN; при нескольких рабочих местах их нужно **не задавать**.

### Журнал действий (txt)

Все API-запросы, события БД и действия UI пишутся в текстовый файл:

```text
src/logs/site-actions-YYYY-MM-DD.txt
```

Формат строки: `[дата время] [канал] действие op=… ws=… ip=… {json}`.

Каналы: `api` (PHP API), `event` (события производства), `ui` / `bench` / `page` / `nav` (браузер).

Пароли и ключи ЛКГ в лог **не попадают** (маскируются). Файлы ротируются по дням; в git не коммитятся (`src/logs/*.txt`).

**Только статика (без OData):**

```bash
./start.sh
# http://localhost:3000
```

## Требования

- Chrome или Edge (Web Serial API)
- HTTPS или localhost
