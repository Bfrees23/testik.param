<?php
declare(strict_types=1);

/**
 * Подключение к локальной БД производства ТМ-07.
 * Приоритет: PostgreSQL → Firebird (откат) → ошибка (без тихого SQLite для стенда).
 * TM07_DB_DRIVER=pgsql|firebird принудительно.
 */

if (!function_exists('site_file_log')) {
    require_once __DIR__ . '/lib/site_file_log.php';
}

function bench_repo_root(): string
{
    $candidates = [
        dirname(__DIR__, 2),
        dirname(__DIR__),
    ];
    foreach ($candidates as $dir) {
        if ($dir === '' || $dir === '/') {
            continue;
        }
        if (is_readable($dir . '/docker-compose.yml') || is_readable($dir . '/.env')) {
            return $dir;
        }
    }
    return dirname(__DIR__, 2);
}

function bench_data_dir(): string
{
    $explicit = bench_env('TM07_DATA_DIR');
    if ($explicit !== null && $explicit !== '') {
        if (!is_dir($explicit)) {
            mkdir($explicit, 0775, true);
        }
        return $explicit;
    }

    $dirs = [
        dirname(__DIR__) . '/data',
        bench_repo_root() . '/data',
    ];
    foreach ($dirs as $dir) {
        if ($dir === '' || $dir === '//data') {
            continue;
        }
        if (is_dir($dir)) {
            return $dir;
        }
        $parent = dirname($dir);
        if (is_dir($parent) && is_writable($parent)) {
            if (!is_dir($dir)) {
                mkdir($dir, 0775, true);
            }
            return $dir;
        }
    }

    $fallback = dirname(__DIR__) . '/data';
    if (!is_dir($fallback)) {
        mkdir($fallback, 0775, true);
    }
    return $fallback;
}

function bench_bootstrap_dotenv(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    $path = bench_repo_root() . '/.env';
    if (!is_readable($path)) {
        return;
    }
    $raw = file_get_contents($path);
    if ($raw === false || $raw === '') {
        return;
    }
    foreach (preg_split('/\r\n|\r|\n/', $raw) as $line) {
        $line = trim((string) $line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        if (!str_contains($line, '=')) {
            continue;
        }
        if (preg_match('/^export\s+/i', $line)) {
            $line = preg_replace('/^export\s+/i', '', $line);
        }
        [$k, $v] = explode('=', $line, 2);
        $k = trim($k);
        $v = trim($v, " \t\"'");
        if ($k === '') {
            continue;
        }
        // Пустая строка из docker-compose (${VAR:-}) не должна блокировать .env.
        $cur = getenv($k);
        if ($cur !== false && trim((string) $cur) !== '') {
            continue;
        }
        putenv($k . '=' . $v);
        $_ENV[$k] = $v;
    }
}

bench_bootstrap_dotenv();

function bench_env(string $key, ?string $default = null): ?string
{
    $v = getenv($key);
    if ($v !== false && $v !== '') {
        return $v;
    }
    return $default;
}

function bench_db_driver(): string
{
    static $driver = null;
    if ($driver !== null) {
        return $driver;
    }
    $forced = strtolower(trim((string) (bench_env('TM07_DB_DRIVER') ?? '')));
    if ($forced === 'pgsql' || $forced === 'postgres' || $forced === 'postgresql') {
        if (!bench_try_pgsql()) {
            throw new RuntimeException('TM07_DB_DRIVER=pgsql, но PostgreSQL недоступен (POSTGRES_HOST/DB)');
        }
        $driver = 'pgsql';
        return $driver;
    }
    if ($forced === 'firebird') {
        if (!bench_try_firebird()) {
            throw new RuntimeException('TM07_DB_DRIVER=firebird, но Firebird недоступен');
        }
        $driver = 'firebird';
        return $driver;
    }
    if ($forced === 'sqlite') {
        $driver = 'sqlite';
        return $driver;
    }
    // Авто: pgsql → firebird → sqlite (только если явно нет PG/FB конфига)
    if (bench_pgsql_dsn() !== null && bench_try_pgsql()) {
        $driver = 'pgsql';
    } elseif (bench_firebird_dsn() !== null && bench_try_firebird()) {
        $driver = 'firebird';
    } else {
        $driver = 'sqlite';
    }
    return $driver;
}

function bench_try_firebird(): bool
{
    static $ok = null;
    if ($ok !== null) {
        return $ok;
    }
    $dsn = bench_firebird_dsn();
    if ($dsn === null) {
        $ok = false;
        return false;
    }
    try {
        $pdo = new PDO($dsn, bench_env('FIREBIRD_USER', 'SYSDBA'), bench_env('FIREBIRD_PASSWORD', 'masterkey'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        $pdo->query('SELECT 1 FROM RDB$DATABASE')->fetch();
        $pdo->query('SELECT COUNT(*) FROM TM07_EVENT_TYPE')->fetchColumn();
        $ok = true;
    } catch (Throwable) {
        $ok = false;
    }
    return $ok;
}

function bench_firebird_dsn(): ?string
{
    $database = bench_env('FIREBIRD_DATABASE');
    if ($database === null || $database === '') {
        return null;
    }
    $host = bench_env('FIREBIRD_HOST');
    $charset = bench_env('FIREBIRD_CHARSET', 'UTF8');
    if ($host !== null && $host !== '') {
        $path = str_replace('\\', '/', $database);
        return sprintf('firebird:dbname=%s:%s;charset=%s', $host, $path, $charset);
    }
    return sprintf('firebird:dbname=%s;charset=%s', $database, $charset);
}

function bench_sqlite_path(): string
{
    return bench_data_dir() . '/tm07_bench.sqlite';
}

/** @return PDO */
function bench_pdo(bool $migrate = true): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $driver = bench_db_driver();

    if ($driver === 'pgsql') {
        $dsn = bench_pgsql_dsn();
        if ($dsn === null) {
            throw new RuntimeException('POSTGRES_HOST / POSTGRES_DB not configured');
        }
        $pdo = new PDO(
            $dsn,
            bench_env('POSTGRES_USER', 'tm07'),
            bench_env('POSTGRES_PASSWORD', 'tm07'),
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_CASE => PDO::CASE_UPPER,
            ]
        );
        $pdo->exec("SET TIME ZONE 'UTC'");
        if ($migrate) {
            bench_pgsql_ensure_schema($pdo);
            bench_run_migrations($pdo);
        }
    } elseif ($driver === 'firebird') {
        $dsn = bench_firebird_dsn();
        if ($dsn === null) {
            throw new RuntimeException('FIREBIRD_DATABASE not configured');
        }
        $pdo = new PDO($dsn, bench_env('FIREBIRD_USER', 'SYSDBA'), bench_env('FIREBIRD_PASSWORD', 'masterkey'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
        if ($migrate) {
            bench_run_migrations($pdo);
        }
    } else {
        $path = bench_sqlite_path();
        $pdo = new PDO('sqlite:' . $path, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_CASE => PDO::CASE_UPPER,
        ]);
        $pdo->exec('PRAGMA foreign_keys = ON');
        if ($migrate) {
            bench_sqlite_migrate($pdo);
            bench_run_migrations($pdo);
        }
    }

    return $pdo;
}

function bench_is_firebird(PDO $pdo): bool
{
    return $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'firebird';
}

function bench_is_pgsql(PDO $pdo): bool
{
    return $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'pgsql';
}

/** SQL expression for "now" — CURRENT_TIMESTAMP on pgsql/firebird, SQLite datetime('now') otherwise. */
function bench_sql_now(PDO $pdo): string
{
    if (bench_is_pgsql($pdo) || bench_is_firebird($pdo)) {
        return 'CURRENT_TIMESTAMP';
    }

    return "datetime('now')";
}

/**
 * Append LIMIT 1 when the select has neither LIMIT nor FIRST.
 * Prefer rewriting call sites: Firebird needs SELECT FIRST 1 … instead of LIMIT.
 */
function bench_sql_limit_one(string $sqlSelect): string
{
    if (preg_match('/\bLIMIT\b/i', $sqlSelect) || preg_match('/\bFIRST\s+\d+/i', $sqlSelect)) {
        return $sqlSelect;
    }

    return rtrim($sqlSelect) . ' LIMIT 1';
}

function bench_pgsql_dsn(): ?string
{
    $host = bench_env('POSTGRES_HOST');
    $db = bench_env('POSTGRES_DB');
    if ($host === null || $host === '' || $db === null || $db === '') {
        return null;
    }
    $port = bench_env('POSTGRES_PORT', '5432') ?: '5432';

    return sprintf('pgsql:host=%s;port=%s;dbname=%s', $host, $port, $db);
}

function bench_try_pgsql(): bool
{
    static $ok = null;
    if ($ok !== null) {
        return $ok;
    }
    $dsn = bench_pgsql_dsn();
    if ($dsn === null) {
        $ok = false;

        return false;
    }
    try {
        $pdo = new PDO(
            $dsn,
            bench_env('POSTGRES_USER', 'tm07'),
            bench_env('POSTGRES_PASSWORD', 'tm07'),
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        $pdo->query('SELECT 1')->fetchColumn();
        $ok = true;
    } catch (Throwable) {
        $ok = false;
    }

    return $ok;
}

/**
 * Apply schema.postgres.sql (idempotent CREATE IF NOT EXISTS + seed).
 */
function bench_pgsql_ensure_schema(PDO $pdo): void
{
    if (bench_table_exists($pdo, 'TM07_EVENT_TYPE') && bench_table_exists($pdo, 'TM07_BENCH_SESSION')) {
        return;
    }
    $candidates = [
        dirname(__DIR__, 2) . '/database/schema.postgres.sql',
        bench_repo_root() . '/database/schema.postgres.sql',
        '/app/database/schema.postgres.sql',
    ];
    $sql = null;
    foreach ($candidates as $path) {
        if (is_readable($path)) {
            $sql = file_get_contents($path);
            break;
        }
    }
    if ($sql === null || $sql === false || trim($sql) === '') {
        throw new RuntimeException('schema.postgres.sql not found — cannot init PostgreSQL');
    }
    // PDO pgsql often accepts only one statement per exec — split safely.
    $sql = preg_replace('/--[^\n]*/', '', $sql) ?? $sql;
    foreach (preg_split('/;\s*\n/', $sql) as $stmt) {
        $stmt = trim($stmt);
        if ($stmt === '') {
            continue;
        }
        try {
            $pdo->exec($stmt);
        } catch (Throwable $e) {
            // IF NOT EXISTS / ON CONFLICT races
            if (!preg_match('/already exists|duplicate/i', $e->getMessage())) {
                throw $e;
            }
        }
    }
}

/**
 * Firebird PDO reports an active transaction after most statements; clear it before explicit transactions.
 */
function bench_pdo_clear_idle_transaction(PDO $pdo): void
{
    if (!$pdo->inTransaction()) {
        return;
    }
    try {
        $pdo->rollBack();
    } catch (Throwable) {
        try {
            $pdo->commit();
        } catch (Throwable) {
            // ignore — connection may already be idle
        }
    }
}

function bench_transaction_begin(PDO $pdo): void
{
    bench_pdo_clear_idle_transaction($pdo);
    $pdo->beginTransaction();
}

function bench_try_add_column(PDO $pdo, string $table, string $column, string $ddl): void
{
    try {
        if (bench_is_firebird($pdo)) {
            $pdo->exec(sprintf('ALTER TABLE %s ADD %s %s', $table, $column, $ddl));
        } else {
            $pdo->exec(sprintf('ALTER TABLE %s ADD COLUMN %s %s', $table, $column, $ddl));
        }
    } catch (Throwable) {
        // column already exists
    }
}

function bench_table_exists(PDO $pdo, string $table): bool
{
    $tableUp = strtoupper($table);
    $tableLow = strtolower($table);
    if (bench_is_firebird($pdo)) {
        $st = $pdo->prepare('SELECT 1 FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = ?');
        $st->execute([$tableUp]);

        return (bool) $st->fetchColumn();
    }
    if (bench_is_pgsql($pdo)) {
        $st = $pdo->prepare(
            'SELECT 1 FROM information_schema.tables WHERE table_schema = \'public\' AND table_name = ?'
        );
        $st->execute([$tableLow]);

        return (bool) $st->fetchColumn();
    }
    $st = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND upper(name) = ?");
    $st->execute([$tableUp]);

    return (bool) $st->fetchColumn();
}

function bench_ensure_bench_session_table(PDO $pdo): void
{
    if (bench_table_exists($pdo, 'TM07_BENCH_SESSION')) {
        return;
    }
    if (bench_is_pgsql($pdo)) {
        bench_pgsql_ensure_schema($pdo);
        return;
    }
    if (bench_is_firebird($pdo)) {
        try {
            $pdo->exec('CREATE GENERATOR GEN_TM07_BENCH_SESSION_ID');
        } catch (Throwable) {
            // already exists
        }
        $pdo->exec(<<<'SQL'
CREATE TABLE TM07_BENCH_SESSION (
    ID              INTEGER NOT NULL PRIMARY KEY,
    ORDER_NUMBER    VARCHAR(64) NOT NULL,
    ORDER_STATUS    VARCHAR(128),
    OPERATOR_ID     INTEGER,
    WORKSTATION_ID  INTEGER NOT NULL,
    ORDER_PAYLOAD   VARCHAR(4096),
    STATE           VARCHAR(16) DEFAULT 'active' NOT NULL,
    OPENED_AT       TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CLOSED_AT       TIMESTAMP,
    CONSTRAINT FK_BS_OP FOREIGN KEY (OPERATOR_ID) REFERENCES TM07_OPERATOR(ID),
    CONSTRAINT FK_BS_WS FOREIGN KEY (WORKSTATION_ID) REFERENCES TM07_WORKSTATION(ID)
)
SQL);
        try {
            $pdo->exec(
                'CREATE TRIGGER BI_TM07_BENCH_SESSION FOR TM07_BENCH_SESSION ACTIVE BEFORE INSERT POSITION 0 AS BEGIN IF (NEW.ID IS NULL) THEN NEW.ID = GEN_ID(GEN_TM07_BENCH_SESSION_ID, 1); END'
            );
        } catch (Throwable) {
            // trigger may already exist
        }
        try {
            $pdo->exec('CREATE INDEX IDX_BS_WS_ACTIVE ON TM07_BENCH_SESSION (WORKSTATION_ID, STATE)');
        } catch (Throwable) {
            // index may already exist
        }
    } else {
        $pdo->exec(<<<'SQL'
CREATE TABLE TM07_BENCH_SESSION (
    ID              INTEGER PRIMARY KEY AUTOINCREMENT,
    ORDER_NUMBER    TEXT NOT NULL,
    ORDER_STATUS    TEXT,
    OPERATOR_ID     INTEGER,
    WORKSTATION_ID  INTEGER NOT NULL,
    ORDER_PAYLOAD   TEXT,
    STATE           TEXT DEFAULT 'active' NOT NULL,
    OPENED_AT       TEXT DEFAULT (datetime('now')) NOT NULL,
    CLOSED_AT       TEXT,
    FOREIGN KEY (OPERATOR_ID) REFERENCES TM07_OPERATOR(ID),
    FOREIGN KEY (WORKSTATION_ID) REFERENCES TM07_WORKSTATION(ID)
);
CREATE INDEX IF NOT EXISTS IDX_BS_WS_ACTIVE ON TM07_BENCH_SESSION (WORKSTATION_ID, STATE);
SQL);
    }
}

function bench_run_migrations(PDO $pdo): void
{
    if (bench_is_pgsql($pdo)) {
        bench_pgsql_ensure_schema($pdo);
    }
    bench_ensure_bench_session_table($pdo);
    $vc = bench_is_firebird($pdo) ? 'VARCHAR(64)' : (bench_is_pgsql($pdo) ? 'VARCHAR(64)' : 'TEXT');
    $vt = bench_is_firebird($pdo) ? 'TIMESTAMP' : (bench_is_pgsql($pdo) ? 'TIMESTAMPTZ' : 'TEXT');
    $v32 = bench_is_firebird($pdo) || bench_is_pgsql($pdo) ? 'VARCHAR(32)' : 'TEXT';
    $v255 = bench_is_firebird($pdo) || bench_is_pgsql($pdo) ? 'VARCHAR(255)' : 'TEXT';
    $v4096 = bench_is_firebird($pdo) ? 'VARCHAR(4096)' : (bench_is_pgsql($pdo) ? 'TEXT' : 'TEXT');
    bench_try_add_column($pdo, 'TM07_OPERATOR', 'LAST_NAME', $vc);
    bench_try_add_column($pdo, 'TM07_OPERATOR', 'FIRST_NAME', $vc);
    bench_try_add_column($pdo, 'TM07_OPERATOR', 'PIN_HASH', $v255);
    bench_try_add_column($pdo, 'TM07_WORKSTATION', 'CLIENT_FINGERPRINT', $vc);
    bench_try_add_column($pdo, 'TM07_WORKSTATION', 'CONFIG_JSON', $v4096);
    bench_try_add_column($pdo, 'TM07_WORKSTATION', 'UPDATED_AT', $vt);
    bench_try_add_column(
        $pdo,
        'TM07_BENCH_SESSION',
        'SESSION_STAGE',
        (bench_is_firebird($pdo) || bench_is_pgsql($pdo) ? "VARCHAR(32) DEFAULT 'assembly'" : "TEXT DEFAULT 'assembly'")
    );
    bench_try_add_column($pdo, 'TM07_BENCH_SESSION', 'SERIAL_CORRECTOR', $v32);
    bench_try_add_column($pdo, 'TM07_BENCH_SESSION', 'ASSEMBLY_CONFIRMED_AT', $vt);
    try {
        if (bench_is_firebird($pdo)) {
            $pdo->exec('CREATE INDEX IDX_SI_ORDER_KIND ON TM07_SERIAL_ISSUED (ORDER_NUMBER, KIND)');
        } else {
            $pdo->exec('CREATE INDEX IF NOT EXISTS IDX_SI_ORDER_KIND ON TM07_SERIAL_ISSUED (ORDER_NUMBER, KIND)');
        }
    } catch (Throwable) {
        // index may already exist
    }

    bench_ensure_corrector_sensor_table($pdo);

    $eventTypes = [
        ['operator_login', 'Вход оператора', 'auth'],
        ['workstation_register', 'Регистрация рабочего места (ПК)', 'auth'],
        ['order_session_open', 'Открытие сессии заказа', 'order'],
        ['order_session_close', 'Закрытие сессии заказа', 'order'],
        ['assembly_confirm', 'Подтверждение сборки корректора', 'assembly'],
        ['serial_corrector', 'Выдача S/N корректора', 'serial'],
        ['serial_complex', 'Выдача S/N комплекса', 'serial'],
        ['nameplate_print', 'Печать шильдика', 'serial'],
        ['sensor_bind', 'Привязка датчика к корректору', 'parametrization'],
        ['parametrization_start', 'Начало параметризации', 'parametrization'],
        ['parametrization_verify', 'Сверка после записи', 'parametrization'],
        ['parametrization_done', 'Параметризация завершена', 'parametrization'],
        ['passport_generate', 'Формирование паспорта', 'parametrization'],
        ['calibration_start', 'Начало калибровки', 'calibration'],
        ['calibration_done', 'Калибровка завершена', 'calibration'],
        ['calibration_phase', 'Этап калибровки', 'calibration'],
    ];
    if (bench_is_firebird($pdo)) {
        $ins = $pdo->prepare('INSERT INTO TM07_EVENT_TYPE (CODE, NAME, STAGE) SELECT ?, ?, ? FROM RDB$DATABASE WHERE NOT EXISTS (SELECT 1 FROM TM07_EVENT_TYPE WHERE CODE = ?)');
        foreach ($eventTypes as $row) {
            $ins->execute([$row[0], $row[1], $row[2], $row[0]]);
        }
    } elseif (bench_is_pgsql($pdo)) {
        $ins = $pdo->prepare(
            'INSERT INTO TM07_EVENT_TYPE (CODE, NAME, STAGE) VALUES (?, ?, ?) ON CONFLICT (CODE) DO NOTHING'
        );
        foreach ($eventTypes as $row) {
            $ins->execute($row);
        }
    } else {
        $ins = $pdo->prepare('INSERT OR IGNORE INTO TM07_EVENT_TYPE (CODE, NAME, STAGE) VALUES (?, ?, ?)');
        foreach ($eventTypes as $row) {
            $ins->execute($row);
        }
    }

    bench_pdo_clear_idle_transaction($pdo);
}

function bench_sqlite_migrate(PDO $pdo): void
{
    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS TM07_WORKSTATION (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    CODE TEXT NOT NULL UNIQUE,
    NAME TEXT,
    HOSTNAME TEXT,
    IS_ACTIVE INTEGER DEFAULT 1 NOT NULL,
    CREATED_AT TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS TM07_OPERATOR (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    LOGIN TEXT NOT NULL UNIQUE,
    DISPLAY_NAME TEXT NOT NULL,
    IS_ACTIVE INTEGER DEFAULT 1 NOT NULL,
    CREATED_AT TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE TABLE IF NOT EXISTS TM07_EVENT_TYPE (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    CODE TEXT NOT NULL UNIQUE,
    NAME TEXT NOT NULL,
    STAGE TEXT
);

CREATE TABLE IF NOT EXISTS TM07_SERIAL_COUNTER (
    PREFIX TEXT NOT NULL,
    MONTH_KEY TEXT NOT NULL,
    LAST_SEQ INTEGER DEFAULT 0 NOT NULL,
    PRIMARY KEY (PREFIX, MONTH_KEY)
);

CREATE TABLE IF NOT EXISTS TM07_SERIAL_ISSUED (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    SERIAL TEXT NOT NULL UNIQUE,
    KIND TEXT NOT NULL,
    PREFIX TEXT NOT NULL,
    MONTH_KEY TEXT NOT NULL,
    SEQ INTEGER NOT NULL,
    OPERATOR_ID INTEGER,
    WORKSTATION_ID INTEGER,
    ORDER_NUMBER TEXT,
    PAYLOAD TEXT,
    ISSUED_AT TEXT DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (OPERATOR_ID) REFERENCES TM07_OPERATOR(ID),
    FOREIGN KEY (WORKSTATION_ID) REFERENCES TM07_WORKSTATION(ID)
);

CREATE INDEX IF NOT EXISTS IDX_SI_ISSUED_AT ON TM07_SERIAL_ISSUED (ISSUED_AT DESC);

CREATE TABLE IF NOT EXISTS TM07_BENCH_EVENT (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    EVENT_TYPE_ID INTEGER NOT NULL,
    EVENT_STATE TEXT DEFAULT 'done' NOT NULL,
    SERIAL_CORRECTOR TEXT,
    SERIAL_COMPLEX TEXT,
    STAGE TEXT,
    OPERATOR_ID INTEGER,
    WORKSTATION_ID INTEGER,
    PAYLOAD TEXT,
    CREATED_AT TEXT DEFAULT (datetime('now')) NOT NULL,
    FOREIGN KEY (EVENT_TYPE_ID) REFERENCES TM07_EVENT_TYPE(ID),
    FOREIGN KEY (OPERATOR_ID) REFERENCES TM07_OPERATOR(ID),
    FOREIGN KEY (WORKSTATION_ID) REFERENCES TM07_WORKSTATION(ID)
);

CREATE INDEX IF NOT EXISTS IDX_BE_SERIAL_C ON TM07_BENCH_EVENT (SERIAL_CORRECTOR, CREATED_AT DESC);
CREATE INDEX IF NOT EXISTS IDX_BE_SERIAL_X ON TM07_BENCH_EVENT (SERIAL_COMPLEX, CREATED_AT DESC);
CREATE INDEX IF NOT EXISTS IDX_BE_CREATED ON TM07_BENCH_EVENT (CREATED_AT DESC);

CREATE TABLE IF NOT EXISTS TM07_CYCLE_PROGRESS (
    SERIAL_NUMBER TEXT NOT NULL PRIMARY KEY,
    PHASE_STATES TEXT NOT NULL,
    NEXT_PHASE_INDEX INTEGER DEFAULT 0 NOT NULL,
    LAST_PHASE TEXT,
    CYCLE_STATUS TEXT,
    REPORT_SUMMARY TEXT,
    OPERATOR_ID INTEGER,
    WORKSTATION_ID INTEGER,
    CREATED_AT TEXT DEFAULT (datetime('now')) NOT NULL,
    UPDATED_AT TEXT DEFAULT (datetime('now')) NOT NULL
);
SQL);

    $defaults = [
        ['serial_corrector', 'Выдача S/N корректора', 'serial'],
        ['serial_complex', 'Выдача S/N комплекса', 'serial'],
        ['nameplate_print', 'Печать шильдика', 'serial'],
        ['sensor_bind', 'Привязка датчика к корректору', 'parametrization'],
        ['parametrization_start', 'Начало параметризации', 'parametrization'],
        ['parametrization_verify', 'Сверка после записи', 'parametrization'],
        ['parametrization_done', 'Параметризация завершена', 'parametrization'],
        ['passport_generate', 'Формирование паспорта', 'parametrization'],
        ['calibration_start', 'Начало калибровки', 'calibration'],
        ['calibration_done', 'Калибровка завершена', 'calibration'],
        ['calibration_phase', 'Этап калибровки', 'calibration'],
    ];
    $ins = $pdo->prepare('INSERT OR IGNORE INTO TM07_EVENT_TYPE (CODE, NAME, STAGE) VALUES (?, ?, ?)');
    foreach ($defaults as $row) {
        $ins->execute($row);
    }
}

/**
 * Таблица привязки датчиков к S/N корректора (PG / SQLite).
 */
function bench_ensure_corrector_sensor_table(PDO $pdo): void
{
    if (bench_table_exists($pdo, 'TM07_CORRECTOR_SENSOR')) {
        // Существующая PG-таблица: FK без ON DELETE SET NULL мешает удалению сессий.
        if (bench_is_pgsql($pdo)) {
            try {
                $pdo->exec('ALTER TABLE tm07_corrector_sensor DROP CONSTRAINT IF EXISTS tm07_corrector_sensor_session_id_fkey');
                $pdo->exec(
                    'ALTER TABLE tm07_corrector_sensor
                     ADD CONSTRAINT tm07_corrector_sensor_session_id_fkey
                     FOREIGN KEY (session_id) REFERENCES tm07_bench_session(id) ON DELETE SET NULL'
                );
            } catch (Throwable) {
            }
        }
        return;
    }
    if (bench_is_pgsql($pdo)) {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS tm07_corrector_sensor (
    id               INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    serial_corrector CHAR(10) NOT NULL,
    channel          VARCHAR(4) NOT NULL,
    sensor_serial    VARCHAR(64) NOT NULL,
    qr_raw           TEXT,
    session_id       INTEGER REFERENCES tm07_bench_session(id) ON DELETE SET NULL,
    order_number     VARCHAR(64),
    operator_id      INTEGER REFERENCES tm07_operator(id),
    workstation_id   INTEGER REFERENCES tm07_workstation(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_cs_sensor_serial UNIQUE (sensor_serial),
    CONSTRAINT uq_cs_corrector_channel UNIQUE (serial_corrector, channel),
    CONSTRAINT chk_cs_channel CHECK (channel IN ('DA', 'DT', 'DD', 'TT'))
)
SQL);
        try {
            $pdo->exec('CREATE INDEX IF NOT EXISTS idx_cs_corrector ON tm07_corrector_sensor (serial_corrector)');
            $pdo->exec('CREATE INDEX IF NOT EXISTS idx_cs_channel ON tm07_corrector_sensor (channel, sensor_serial)');
        } catch (Throwable) {
        }
        return;
    }
    if (bench_is_firebird($pdo)) {
        // Firebird legacy: optional; стенд на PG
        return;
    }
    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS TM07_CORRECTOR_SENSOR (
    ID INTEGER PRIMARY KEY AUTOINCREMENT,
    SERIAL_CORRECTOR TEXT NOT NULL,
    CHANNEL TEXT NOT NULL,
    SENSOR_SERIAL TEXT NOT NULL UNIQUE,
    QR_RAW TEXT,
    SESSION_ID INTEGER,
    ORDER_NUMBER TEXT,
    OPERATOR_ID INTEGER,
    WORKSTATION_ID INTEGER,
    CREATED_AT TEXT DEFAULT (datetime('now')) NOT NULL,
    UPDATED_AT TEXT DEFAULT (datetime('now')) NOT NULL,
    UNIQUE (SERIAL_CORRECTOR, CHANNEL)
)
SQL);
}

function bench_json_response(array $payload, int $code = 200): never
{
    if (function_exists('site_file_log_set_response')) {
        site_file_log_set_response($payload, $code);
    }
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function bench_read_json_body(): array
{
    if (isset($GLOBALS['SITE_FILE_LOG_BODY']) && is_array($GLOBALS['SITE_FILE_LOG_BODY'])) {
        return $GLOBALS['SITE_FILE_LOG_BODY'];
    }
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        $GLOBALS['SITE_FILE_LOG_BODY'] = [];
        return [];
    }
    $data = json_decode($raw, true);
    $body = is_array($data) ? $data : [];
    $GLOBALS['SITE_FILE_LOG_BODY'] = $body;
    return $body;
}

function bench_last_insert_id(PDO $pdo, string $table = 'TM07_BENCH_EVENT'): int
{
    if (bench_is_firebird($pdo) || bench_is_pgsql($pdo)) {
        throw new RuntimeException(
            'pgsql/firebird: используйте INSERT … RETURNING ID вместо lastInsertId() (' . $table . ')'
        );
    }
    return (int) $pdo->lastInsertId();
}
