# Selenium full-test · ПК-ТМ

Полная автоматическая проверка сайта калибровки/параметризации ТМ-07.

## Требования

- Python 3.10+
- Google Chrome (для headless или с окном)
- Запущенный сайт (по умолчанию Docker на `http://localhost:8081`)

## Установка

```bash
cd "LAST VERSION/selenium-bot"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

В `.env` при необходимости измените:

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `BASE_URL` | `http://localhost:8081` | Адрес сайта |
| `ADMIN_PASSWORD` | `admin` | Пароль администратора |
| `OPERATOR_LAST_NAME` | `Тестов` | Фамилия |
| `OPERATOR_FIRST_NAME` | `Бот` | Имя (необязательно) |
| `RUN_REPEAT` | `1` | Сколько раз подряд запускать (или `--repeat N`) |
| `REPEAT_INTERVAL` | `0` | Пауза между прогонами, сек |
| `STOP_ON_FAIL` | — | `1` = остановиться после первого прогона с ошибками |
### KAO + 1C (integration)

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `KAO_COM_PORT` | `COM8` | COM-порт адаптера КАО (Windows) |
| `KAO_BAUD` | `19200` | Скорость Modbus |
| `KAO_CONNECT_TIMEOUT` | `90` | Ожидание подключения КАО (сек) |
| `KAO_USE_ANY_USB` | `1` | `1` = кнопка «Любой COM» (для COM8) |

**Первый запуск КАО:** Web Serial не знает имя COM8 — один раз выберите порт вручную:

```bash
python run_bot.py --watch
```

После выбора COM8 Chrome сохранит разрешение в `.chrome-profile/` и следующие прогоны подключатся автоматически.

**Заказ 1С:** укажите реальный номер в `TEST_ORDER_NUMBER` (должен быть в 1С за текущий год).

## Запуск

```bash
python run_bot.py
python run_bot.py --watch         # видимый браузер, подсветка, паузы (рекомендуется)
python run_bot.py -v              # лог шагов и проверок в консоль (без пауз)
python run_bot.py --api-only      # без браузера (только API)
python run_bot.py --no-headless   # окно Chrome без пауз
python run_bot.py --watch --pause 2.0   # медленнее, удобнее наблюдать
python run_bot.py --repeat 5            # 5 прогонов подряд
python run_bot.py -n 10 --interval 3    # 10 прогонов, пауза 3 сек между ними
python run_bot.py --repeat 3 --stop-on-fail   # остановиться при первом FAIL
```

В режиме `--watch` бот открывает окно Chromium, подсвечивает элементы синей рамкой и пишет каждый шаг в консоль. После завершения браузер остаётся открытым до нажатия Enter.

**Почему «тишина» в обычном режиме:** без `--watch` / `-v` шаги (`watch.step`) и проверки (`report.ok`) только накапливаются в отчёт и печатаются **в конце** одним блоком. `HEADLESS=0` в `.env` лишь показывает окно Chrome, но не включает пошаговый лог.

Отчёты сохраняются в `reports/`:

- `report-latest.txt` — текстовый итог
- `report-latest.html` — таблица результатов
- `report-YYYY-MM-DD_HH-MM-SS.json` — машиночитаемый формат

Код выхода: `0` — все проверки пройдены, `1` — есть ошибки.

### Через pytest

```bash
pytest tests/test_smoke.py -v
```

## Что проверяется (~95 тестов)

### API (без браузера)
- `bench-db-status`, `auth`, `admin-settings`, `site-action-log`
- `bench-events` (types + log), `odata-1c` config, `counters`, `serial-registry`
- `bench-cycle-progress`, admin session (get settings)

### UI — все 8 страниц
- Главная, workbench, параметризация KAO, счётчики, заказ 1С, login, M90, admin

### Сценарии
| Модуль | Проверки |
|--------|----------|
| **Навигация** | шапка, mobile menu, operator/admin slot |
| **Auth** | оператор (валидация + вход), login admin |
| **Home** | дашборд, фильтр сессий, быстрые ссылки, новая сессия |
| **Workbench UI** | блоки UI, заказ, таблица 79 параметров, QR MIDA |
| **Workbench E2E** | selectOrder → S/N → confirmAssembly → unlock → QR → cleanup |
| **Parametrization** | KAO + counters: connect, filter, JSON заказа, serial peek |
| **Order 1C** | OData load, JSON parse, export |
| **M90 bench** | USB, PKD, корректор, сценарий, фазы, настройки, лог |
| **KAO + 1C** | COM8 preflight, OData API, workbench load, assembly, KAO connect, order page |

### Не автоматизируется (нужно железо)
- Web Serial: КАО, Modbus read/write, USB M90/MIT/PKD
- Живой OData 1С (если сервер недоступен — используется JSON fallback)

## WSL / Linux

Chrome запускается с флагами `--no-sandbox` и `--disable-dev-shm-usage`. Драйвер скачивается автоматически через `webdriver-manager`.

Если Chrome не установлен:

```bash
wget -q -O /tmp/google-chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y /tmp/google-chrome.deb
```

## Ограничения

- Не тестируется реальное подключение КАО/Modbus и OData 1С (нужны железо и сеть).
- Кнопка «Войти в заказ» на workbench не нажимается с реальным OData — только UI и парсер QR.
- Для CI можно добавить job с `HEADLESS=1` после поднятия `docker compose up`.
