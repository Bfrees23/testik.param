<?php
declare(strict_types=1);

/**
 * Подключение к локальной БД производства ТМ-07.
 * Приоритет: Firebird (IBExpert / .fdb) → SQLite fallback для dev без сервера Firebird.
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
    if (bench_try_firebird()) {
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

    if (bench_db_driver() === 'firebird') {
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
    $table = strtoupper($table);
    if (bench_is_firebird($pdo)) {
        $st = $pdo->prepare('SELECT 1 FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = ?');
        $st->execute([$table]);

        return (bool) $st->fetchColumn();
    }
    $st = $pdo->prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?");
    $st->execute([$table]);

    return (bool) $st->fetchColumn();
}

function bench_ensure_bench_session_table(PDO $pdo): void
{
    if (bench_table_exists($pdo, 'TM07_BENCH_SESSION')) {
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
    bench_ensure_bench_session_table($pdo);
    bench_try_add_column($pdo, 'TM07_OPERATOR', 'LAST_NAME', bench_is_firebird($pdo) ? 'VARCHAR(64)' : 'TEXT');
    bench_try_add_column($pdo, 'TM07_OPERATOR', 'FIRST_NAME', bench_is_firebird($pdo) ? 'VARCHAR(64)' : 'TEXT');
    bench_try_add_column($pdo, 'TM07_OPERATOR', 'PIN_HASH', bench_is_firebird($pdo) ? 'VARCHAR(255)' : 'TEXT');
    bench_try_add_column($pdo, 'TM07_WORKSTATION', 'CLIENT_FINGERPRINT', bench_is_firebird($pdo) ? 'VARCHAR(64)' : 'TEXT');
    bench_try_add_column($pdo, 'TM07_WORKSTATION', 'CONFIG_JSON', bench_is_firebird($pdo) ? 'VARCHAR(4096)' : 'TEXT');
    bench_try_add_column(
        $pdo,
        'TM07_WORKSTATION',
        'UPDATED_AT',
        bench_is_firebird($pdo) ? 'TIMESTAMP' : 'TEXT'
    );
    bench_try_add_column(
        $pdo,
        'TM07_BENCH_SESSION',
        'SESSION_STAGE',
        bench_is_firebird($pdo) ? "VARCHAR(32) DEFAULT 'assembly'" : "TEXT DEFAULT 'assembly'"
    );
    bench_try_add_column(
        $pdo,
        'TM07_BENCH_SESSION',
        'SERIAL_CORRECTOR',
        bench_is_firebird($pdo) ? 'VARCHAR(32)' : 'TEXT'
    );
    bench_try_add_column(
        $pdo,
        'TM07_BENCH_SESSION',
        'ASSEMBLY_CONFIRMED_AT',
        bench_is_firebird($pdo) ? 'TIMESTAMP' : 'TEXT'
    );
    try {
        if (bench_is_firebird($pdo)) {
            $pdo->exec('CREATE INDEX IDX_SI_ORDER_KIND ON TM07_SERIAL_ISSUED (ORDER_NUMBER, KIND)');
        } else {
            $pdo->exec('CREATE INDEX IF NOT EXISTS IDX_SI_ORDER_KIND ON TM07_SERIAL_ISSUED (ORDER_NUMBER, KIND)');
        }
    } catch (Throwable) {
        // index may already exist
    }

    $eventTypes = [
        ['operator_login', 'Вход оператора', 'auth'],
        ['workstation_register', 'Регистрация рабочего места (ПК)', 'auth'],
        ['order_session_open', 'Открытие сессии заказа', 'order'],
        ['order_session_close', 'Закрытие сессии заказа', 'order'],
        ['assembly_confirm', 'Подтверждение сборки корректора', 'assembly'],
        ['serial_corrector', 'Выдача S/N корректора', 'serial'],
        ['serial_complex', 'Выдача S/N комплекса', 'serial'],
        ['nameplate_print', 'Печать шильдика', 'serial'],
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
    if (bench_is_firebird($pdo)) {
        throw new RuntimeException(
            'Firebird: используйте INSERT … RETURNING ID вместо lastInsertId() (' . $table . ')'
        );
    }
    return (int) $pdo->lastInsertId();
}
