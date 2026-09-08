<?php
declare(strict_types=1);

require_once __DIR__ . '/db_bench.php';
require_once __DIR__ . '/auth_common.php';
require_once __DIR__ . '/lib/serial_xlsx.php';

if (session_status() !== PHP_SESSION_ACTIVE) {
    auth_session_start();
}

const BENCH_SESSION_OPERATOR = 'bench_operator';
const BENCH_SESSION_WORKSTATION = 'bench_workstation_id';
const BENCH_SESSION_ORDER = 'bench_order_session_id';

function bench_operator_display_name(?string $lastName, ?string $firstName, ?string $fallback = ''): string
{
    $last = trim((string) $lastName);
    $first = trim((string) $firstName);
    if ($last !== '' && $first !== '') {
        return $last . ' ' . $first;
    }
    if ($last !== '') {
        return $last;
    }
    if ($first !== '') {
        return $first;
    }
    return trim((string) $fallback);
}

/**
 * Дата/время для UI: всегда Europe/Moscow, ISO с оффсетом (+03:00).
 * PostgreSQL/SQLite naive timestamps — UTC; Firebird CURRENT_TIMESTAMP — обычно локаль сервера (МСК).
 */
function bench_format_ts_moscow(mixed $raw): ?string
{
    if ($raw === null || $raw === '') {
        return null;
    }
    $s = trim((string) $raw);
    if ($s === '') {
        return null;
    }
    try {
        $moscow = new DateTimeZone('Europe/Moscow');
        if (preg_match('/[zZ]|[+-]\d{2}:?\d{2}$/', $s)) {
            $dt = new DateTimeImmutable($s);
        } else {
            $driver = function_exists('bench_db_driver') ? bench_db_driver() : '';
            $naiveTz =
                ($driver === 'sqlite' || $driver === 'pgsql')
                    ? new DateTimeZone('UTC')
                    : $moscow;
            $dt = new DateTimeImmutable($s, $naiveTz);
        }
        return $dt->setTimezone($moscow)->format('c');
    } catch (Throwable) {
        return $s;
    }
}

/** Текущее время МСК (для явных timestamp-полей при необходимости). */
function bench_now_moscow_sql(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow')))->format('Y-m-d H:i:s');
}

function bench_operator_select_cols(): string
{
    return 'ID, LOGIN, DISPLAY_NAME, LAST_NAME, FIRST_NAME, PIN_HASH';
}

function bench_find_operator_by_names(PDO $pdo, string $lastName, ?string $firstName): ?array
{
    $lastName = trim($lastName);
    if ($lastName === '') {
        return null;
    }
    $first = $firstName !== null ? trim($firstName) : '';
    if ($first === '') {
        $first = null;
    }
    $cols = bench_operator_select_cols();
    if ($first === null) {
        $sel = $pdo->prepare(
            "SELECT {$cols} FROM TM07_OPERATOR
             WHERE LAST_NAME = ? AND (FIRST_NAME IS NULL OR TRIM(FIRST_NAME) = '')"
        );
        $sel->execute([$lastName]);
    } else {
        $sel = $pdo->prepare(
            "SELECT {$cols} FROM TM07_OPERATOR WHERE LAST_NAME = ? AND FIRST_NAME = ?"
        );
        $sel->execute([$lastName, $first]);
    }
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function bench_set_operator_pin_hash(PDO $pdo, int $operatorId, string $pin): void
{
    $hash = bench_hash_operator_pin($pin);
    $st = $pdo->prepare('UPDATE TM07_OPERATOR SET PIN_HASH = ? WHERE ID = ?');
    $st->execute([$hash, $operatorId]);
}

/**
 * После успешного входа по .env PIN — сохранить hash в БД (персональный приоритет дальше).
 */
function bench_persist_operator_pin_if_needed(PDO $pdo, array $operatorRow, string $pin): void
{
    $pin = trim($pin);
    if ($pin === '' || $operatorRow === [] || empty($operatorRow['ID'])) {
        return;
    }
    if (!empty($operatorRow['PIN_HASH'])) {
        return;
    }
    $last = trim((string) ($operatorRow['LAST_NAME'] ?? ''));
    $first = isset($operatorRow['FIRST_NAME']) ? trim((string) $operatorRow['FIRST_NAME']) : '';
    $personal = $last !== '' ? bench_env_pin_for_operator($last, $first !== '' ? $first : null) : null;
    if ($personal !== null && hash_equals($personal, $pin)) {
        bench_set_operator_pin_hash($pdo, (int) $operatorRow['ID'], $pin);
        return;
    }
    // Первый вход по общему PIN — тоже запоминаем как персональный hash этого оператора,
    // чтобы дальше у каждого был свой (сменить через админку / BENCH_OPERATOR_PINS).
    $shared = bench_shared_operator_pin();
    if ($shared !== '' && hash_equals($shared, $pin) && $personal === null) {
        // не автосохраняем общий PIN всем — иначе все получат одинаковый hash и смена общего .env не поможет
        return;
    }
}

/**
 * @return list<array<string,mixed>>
 */
function bench_list_operators(PDO $pdo, int $limit = 100): array
{
    $limit = max(1, min(500, $limit));
    $cols = bench_operator_select_cols();
    if (bench_is_firebird($pdo)) {
        $st = $pdo->query("SELECT FIRST {$limit} {$cols} FROM TM07_OPERATOR ORDER BY LAST_NAME, FIRST_NAME, LOGIN");
    } else {
        $st = $pdo->query("SELECT {$cols} FROM TM07_OPERATOR ORDER BY LAST_NAME, FIRST_NAME, LOGIN LIMIT {$limit}");
    }
    $rows = $st ? $st->fetchAll(PDO::FETCH_ASSOC) : [];
    return is_array($rows) ? $rows : [];
}

/** Внутренний ключ оператора в БД (не вводится на стенде). */
function bench_operator_auto_login(string $lastName, ?string $firstName): string
{
    $key = mb_strtolower(trim($lastName)) . '|' . mb_strtolower(trim((string) ($firstName ?? '')));
    return 'OP_' . strtoupper(substr(hash('sha256', $key), 0, 12));
}

/** Нормализация кода места: pm-01 → PM-01. */
function bench_normalize_workstation_code(string $code): string
{
    $code = trim($code);
    if ($code === '') {
        return '';
    }
    $code = preg_replace('/\s+/u', '-', $code) ?? $code;
    $code = preg_replace('/[^A-Za-z0-9_-]/', '', $code) ?? $code;
    $code = strtoupper($code);
    if (strlen($code) > 64) {
        $code = substr($code, 0, 64);
    }

    return $code;
}

function bench_workstation_label_from_config(?array $config): string
{
    if (!is_array($config)) {
        return 'Рабочее место';
    }
    $ua = (string) ($config['userAgent'] ?? '');
    $platform = (string) ($config['platform'] ?? '');
    $screen = $config['screen'] ?? null;
    $sw = is_array($screen) ? (int) ($screen['width'] ?? 0) : 0;
    $sh = is_array($screen) ? (int) ($screen['height'] ?? 0) : 0;
    $browser = 'Браузер';
    if (stripos($ua, 'Edg/') !== false) {
        $browser = 'Edge';
    } elseif (stripos($ua, 'Chrome/') !== false) {
        $browser = 'Chrome';
    } elseif (stripos($ua, 'Firefox/') !== false) {
        $browser = 'Firefox';
    }
    $os = $platform !== '' ? $platform : 'ПК';
    if (stripos($ua, 'Windows') !== false) {
        $os = 'Windows';
    } elseif (stripos($ua, 'Linux') !== false) {
        $os = 'Linux';
    }
    $label = $browser . ' / ' . $os;
    if ($sw > 0 && $sh > 0) {
        $label .= ' · ' . $sw . '×' . $sh;
    }
    return $label;
}

function bench_normalize_client_config($config): ?array
{
    if (!is_array($config)) {
        return null;
    }
    $allowed = ['userAgent', 'platform', 'language', 'languages', 'screen', 'timezone', 'hardwareConcurrency', 'deviceMemory', 'pageUrl', 'collectedAt', 'senselockAgent'];
    $out = [];
    foreach ($allowed as $key) {
        if (array_key_exists($key, $config)) {
            $out[$key] = $config[$key];
        }
    }
    return $out ?: null;
}

function bench_workstation_row_to_api(array $row): array
{
    $config = null;
    if (!empty($row['CONFIG_JSON'])) {
        $decoded = json_decode((string) $row['CONFIG_JSON'], true);
        if (is_array($decoded)) {
            $config = $decoded;
        }
    }
    return [
        'id' => (int) $row['ID'],
        'code' => $row['CODE'],
        'name' => $row['NAME'] ?? null,
        'hostname' => $row['HOSTNAME'] ?? null,
        'fingerprint' => $row['CLIENT_FINGERPRINT'] ?? null,
        'clientConfig' => $config,
        'updatedAt' => $row['UPDATED_AT'] ?? null,
    ];
}

function bench_operator_row_to_api(array $row): array
{
    return [
        'id' => (int) $row['ID'],
        'login' => $row['LOGIN'],
        'displayName' => $row['DISPLAY_NAME'],
        'lastName' => $row['LAST_NAME'] ?? null,
        'firstName' => $row['FIRST_NAME'] ?? null,
        'hasPin' => !empty($row['PIN_HASH']),
    ];
}

function bench_find_workstation(PDO $pdo, ?string $code = null, ?string $fingerprint = null): ?array
{
    $selectSql =
        'SELECT ID, CODE, NAME, HOSTNAME, CLIENT_FINGERPRINT, CONFIG_JSON, UPDATED_AT FROM TM07_WORKSTATION WHERE ';

    if ($code !== null && $code !== '') {
        $sel = $pdo->prepare($selectSql . 'CODE = ?');
        $sel->execute([$code]);
        $row = $sel->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            return $row;
        }
    }
    if ($fingerprint !== null && $fingerprint !== '') {
        $sel = $pdo->prepare($selectSql . 'CLIENT_FINGERPRINT = ?');
        $sel->execute([$fingerprint]);
        $row = $sel->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            return $row;
        }
    }

    return null;
}

function bench_workstation_needs_update(array $row, string $name, ?string $hostname, ?string $fingerprint, ?string $configJson): bool
{
    if ($configJson !== null && ($row['CONFIG_JSON'] ?? '') !== $configJson) {
        return true;
    }
    if ($fingerprint !== '' && ($row['CLIENT_FINGERPRINT'] ?? '') !== $fingerprint) {
        return true;
    }
    if (($row['NAME'] ?? '') !== $name) {
        return true;
    }
    if ($hostname !== null && ($row['HOSTNAME'] ?? '') !== $hostname) {
        return true;
    }

    return false;
}

function bench_pdo_retry(callable $fn, int $maxAttempts = 3)
{
    $attempt = 0;
    while (true) {
        try {
            return $fn();
        } catch (PDOException $e) {
            $attempt++;
            $msg = $e->getMessage();
            $retryable = str_contains($msg, '-913') || str_contains($msg, 'deadlock');
            if (!$retryable || $attempt >= $maxAttempts) {
                throw $e;
            }
            usleep(50_000 * $attempt);
        }
    }
}

function bench_resolve_workstation(PDO $pdo, ?string $code = null, ?array $clientBody = null): array
{
    $clientBody = is_array($clientBody) ? $clientBody : [];
    $clientConfig = bench_normalize_client_config($clientBody['clientConfig'] ?? null);
    $fingerprint = trim((string) ($clientBody['fingerprint'] ?? ''));
    if ($fingerprint === '') {
        $fingerprint = trim((string) ($clientBody['workstationFingerprint'] ?? ''));
    }

    // Явный код места (?ws=pm-01 / workstationCode) важнее fingerprint.
    $explicitCode = bench_normalize_workstation_code((string) ($code ?? ''));
    if ($explicitCode === '') {
        $explicitCode = bench_normalize_workstation_code(
            (string) ($clientBody['workstationCode'] ?? $clientBody['code'] ?? '')
        );
    }
    if ($explicitCode === '') {
        $explicitCode = bench_normalize_workstation_code((string) (bench_env('TM07_WORKSTATION_CODE') ?: ''));
    }

    if ($explicitCode !== '') {
        $code = $explicitCode;
        $name = bench_env('TM07_WORKSTATION_NAME') ?: ('Рабочее место ' . $code);
    } elseif ($fingerprint !== '') {
        // Legacy: без ?ws= код = fingerprint браузера.
        $code = $fingerprint;
        $name = $clientConfig
            ? bench_workstation_label_from_config($clientConfig)
            : (bench_env('TM07_WORKSTATION_NAME') ?: ('Рабочее место ' . $code));
    } else {
        $code = gethostname() ?: 'local';
        $name = $clientConfig
            ? bench_workstation_label_from_config($clientConfig)
            : (bench_env('TM07_WORKSTATION_NAME') ?: ('Рабочее место ' . $code));
    }

    $hostname = gethostname() ?: null;
    $configJson = $clientConfig ? json_encode($clientConfig, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;
    $nowExpr = bench_sql_now($pdo);

    $selectSql =
        'SELECT ID, CODE, NAME, HOSTNAME, CLIENT_FINGERPRINT, CONFIG_JSON, UPDATED_AT FROM TM07_WORKSTATION WHERE ';

    $row = null;
    if ($code !== '') {
        $sel = $pdo->prepare($selectSql . 'CODE = ?');
        $sel->execute([$code]);
        $row = $sel->fetch(PDO::FETCH_ASSOC) ?: null;
    }
    if (!$row && $fingerprint !== '') {
        $sel = $pdo->prepare($selectSql . 'CLIENT_FINGERPRINT = ?');
        $sel->execute([$fingerprint]);
        $row = $sel->fetch(PDO::FETCH_ASSOC) ?: null;
        if ($row && ($row['CODE'] ?? '') !== $code) {
            $chk = $pdo->prepare('SELECT ID FROM TM07_WORKSTATION WHERE CODE = ? AND ID <> ?');
            $chk->execute([$code, $row['ID']]);
            if (!$chk->fetchColumn()) {
                $pdo->prepare('UPDATE TM07_WORKSTATION SET CODE = ? WHERE ID = ?')->execute([$code, $row['ID']]);
                $row['CODE'] = $code;
            }
        }
    }

    if ($row) {
        if (
            $configJson !== null
            || $fingerprint !== ''
            || $clientConfig
        ) {
            $newName = $explicitCode !== '' && trim((string) ($row['NAME'] ?? '')) !== ''
                ? (string) $row['NAME']
                : ($clientConfig ? $name : ($row['NAME'] ?? $name));
            if (bench_workstation_needs_update($row, $newName, $hostname, $fingerprint, $configJson)) {
                bench_pdo_retry(static function () use ($pdo, $newName, $hostname, $fingerprint, $configJson, $nowExpr, $row): void {
                    $upd = $pdo->prepare(
                        'UPDATE TM07_WORKSTATION SET NAME = ?, HOSTNAME = ?, CLIENT_FINGERPRINT = ?, CONFIG_JSON = COALESCE(?, CONFIG_JSON), UPDATED_AT = ' . $nowExpr . ' WHERE ID = ?'
                    );
                    $upd->execute([
                        $newName,
                        $hostname,
                        $fingerprint !== '' ? $fingerprint : ($row['CLIENT_FINGERPRINT'] ?? null),
                        $configJson,
                        $row['ID'],
                    ]);
                });
                $sel = $pdo->prepare($selectSql . 'ID = ?');
                $sel->execute([(int) $row['ID']]);
                $row = $sel->fetch(PDO::FETCH_ASSOC) ?: $row;
            }
        }

        return $row;
    }

    return bench_pdo_retry(static function () use ($pdo, $code, $name, $hostname, $fingerprint, $configJson, $nowExpr): array {
        if (bench_is_firebird($pdo) || bench_is_pgsql($pdo)) {
            try {
                $ins = $pdo->prepare(
                    'INSERT INTO TM07_WORKSTATION (CODE, NAME, HOSTNAME, CLIENT_FINGERPRINT, CONFIG_JSON, UPDATED_AT)
                     VALUES (?, ?, ?, ?, ?, ' . $nowExpr . ')
                     RETURNING ID, CODE, NAME, HOSTNAME, CLIENT_FINGERPRINT, CONFIG_JSON, UPDATED_AT'
                );
                $ins->execute([$code, $name, $hostname, $fingerprint !== '' ? $fingerprint : null, $configJson]);
                $created = $ins->fetch(PDO::FETCH_ASSOC);
                if (!$created) {
                    throw new RuntimeException('Не удалось создать рабочую станцию');
                }

                return $created;
            } catch (PDOException $e) {
                $msg = $e->getMessage();
                $isUnique =
                    str_contains($msg, '-803')
                    || str_contains($msg, '23505')
                    || stripos($msg, 'unique') !== false;
                if (!$isUnique) {
                    throw $e;
                }
                $existing = bench_find_workstation($pdo, $code, $fingerprint !== '' ? $fingerprint : null);
                if (!$existing) {
                    throw $e;
                }

                return $existing;
            }
        }

        $ins = $pdo->prepare(
            'INSERT INTO TM07_WORKSTATION (CODE, NAME, HOSTNAME, CLIENT_FINGERPRINT, CONFIG_JSON, UPDATED_AT)
             VALUES (?, ?, ?, ?, ?, ' . $nowExpr . ')'
        );
        $ins->execute([$code, $name, $hostname, $fingerprint !== '' ? $fingerprint : null, $configJson]);

        return [
            'ID' => (int) $pdo->lastInsertId(),
            'CODE' => $code,
            'NAME' => $name,
            'HOSTNAME' => $hostname,
            'CLIENT_FINGERPRINT' => $fingerprint !== '' ? $fingerprint : null,
            'CONFIG_JSON' => $configJson,
            'UPDATED_AT' => gmdate('c'),
        ];
    });
}

function bench_register_client_workstation(PDO $pdo, array $body): array
{
    $ws = bench_resolve_workstation($pdo, null, $body);
    $_SESSION[BENCH_SESSION_WORKSTATION] = (int) $ws['ID'];

    if (!empty($body['kaoUsb']) && is_array($body['kaoUsb'])) {
        $ws = bench_merge_kao_usb_into_workstation($pdo, $ws, $body['kaoUsb']);
    }

    try {
        bench_log_event($pdo, [
            'eventType' => 'workstation_register',
            'eventState' => 'done',
            'stage' => 'auth',
            'workstationCode' => $ws['CODE'],
            'payload' => [
                'fingerprint' => $ws['CLIENT_FINGERPRINT'] ?? null,
                'name' => $ws['NAME'] ?? null,
                'clientConfig' => bench_normalize_client_config($body['clientConfig'] ?? null),
                'kaoUsb' => !empty($body['kaoUsb']) && is_array($body['kaoUsb']) ? $body['kaoUsb'] : null,
            ],
        ]);
    } catch (Throwable) {
        // журнал необязателен для регистрации
    }

    return $ws;
}

/**
 * Дописать VID/PID/S/N адаптера КАО в CONFIG_JSON.deviceUsb рабочего места.
 *
 * @param array<string,mixed> $row
 * @param array<string,mixed> $kao
 * @return array<string,mixed>
 */
function bench_merge_kao_usb_into_workstation(PDO $pdo, array $row, array $kao): array
{
    $id = (int) ($row['ID'] ?? 0);
    if ($id <= 0) {
        return $row;
    }

    $cfg = [];
    if (!empty($row['CONFIG_JSON'])) {
        $decoded = json_decode((string) $row['CONFIG_JSON'], true);
        if (is_array($decoded)) {
            $cfg = $decoded;
        }
    }
    $usb = isset($cfg['deviceUsb']) && is_array($cfg['deviceUsb']) ? $cfg['deviceUsb'] : [];

    $patch = [];
    $vid = trim((string) ($kao['vendorIdHex'] ?? $kao['usbVendorIdHex'] ?? ''));
    if ($vid === '' && isset($kao['usbVendorId'])) {
        $vid = sprintf('0x%04X', (int) $kao['usbVendorId'] & 0xffff);
    }
    $pid = trim((string) ($kao['productIdHex'] ?? $kao['tm07ProductIdHex'] ?? $kao['usbProductIdHex'] ?? ''));
    if ($pid === '' && isset($kao['usbProductId'])) {
        $pid = sprintf('0x%04X', (int) $kao['usbProductId'] & 0xffff);
    }
    $serial = trim((string) ($kao['serialNumber'] ?? $kao['kaoSerialNumber'] ?? ''));

    if ($vid !== '') {
        $patch['vendorIdHex'] = $vid;
    }
    if ($pid !== '') {
        $patch['tm07ProductIdHex'] = $pid;
    }
    // S/N адаптера: пишем при первом появлении; не затираем пустым.
    if ($serial !== '') {
        $patch['kaoSerialNumber'] = $serial;
    }

    if ($patch === []) {
        return $row;
    }

    $merged = bench_normalize_device_usb(array_merge($usb, $patch));
    // Не затирать уже сохранённый kaoSerialNumber пустым патчем (его нет в $patch).
    if (
        empty($merged['kaoSerialNumber'])
        && !empty($usb['kaoSerialNumber'])
        && $serial === ''
    ) {
        $merged['kaoSerialNumber'] = trim((string) $usb['kaoSerialNumber']);
    }

    $cfg['deviceUsb'] = $merged;
    $configJson = json_encode($cfg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $nowExpr = bench_sql_now($pdo);
    bench_pdo_retry(static function () use ($pdo, $configJson, $nowExpr, $id): void {
        $upd = $pdo->prepare(
            'UPDATE TM07_WORKSTATION SET CONFIG_JSON = ?, UPDATED_AT = ' . $nowExpr . ' WHERE ID = ?'
        );
        $upd->execute([$configJson, $id]);
    });

    $row['CONFIG_JSON'] = $configJson;

    return $row;
}

/**
 * Резолв оператора.
 * @param bool $bindSession писать в PHP-сессию. true только для selectOperator / явного входа.
 */
function bench_resolve_operator(
    PDO $pdo,
    ?string $login = null,
    ?string $displayName = null,
    ?string $lastName = null,
    ?string $firstName = null,
    bool $bindSession = true
): ?array {
    $sessionOp = $_SESSION[BENCH_SESSION_OPERATOR] ?? null;
    if (($login === null || trim($login) === '') && is_array($sessionOp)) {
        return $sessionOp;
    }
    if ($login === null || trim($login) === '') {
        return null;
    }
    $login = trim($login);
    if ($lastName !== null) {
        $lastName = trim($lastName);
        if ($lastName === '') {
            $lastName = null;
        }
    }
    if ($firstName !== null) {
        $firstName = trim($firstName);
        if ($firstName === '') {
            $firstName = null;
        }
    }
    if ($displayName !== null) {
        $displayName = trim($displayName);
        if ($displayName === '') {
            $displayName = null;
        }
    }
    if ($displayName === null) {
        $displayName = bench_operator_display_name($lastName, $firstName, $login);
    }

    $cols = bench_operator_select_cols();
    $sel = $pdo->prepare("SELECT {$cols} FROM TM07_OPERATOR WHERE LOGIN = ?");
    $sel->execute([$login]);
    $row = $sel->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        if ($lastName === null || $lastName === '') {
            throw new InvalidArgumentException('lastName (фамилия) обязательна для нового оператора');
        }
        if (bench_is_firebird($pdo) || bench_is_pgsql($pdo)) {
            $ins = $pdo->prepare(
                "INSERT INTO TM07_OPERATOR (LOGIN, DISPLAY_NAME, LAST_NAME, FIRST_NAME) VALUES (?, ?, ?, ?)
                 RETURNING {$cols}"
            );
            $ins->execute([$login, $displayName, $lastName, $firstName]);
            $row = $ins->fetch(PDO::FETCH_ASSOC);
            if (!$row) {
                throw new RuntimeException('Не удалось создать оператора');
            }
        } else {
            $ins = $pdo->prepare('INSERT INTO TM07_OPERATOR (LOGIN, DISPLAY_NAME, LAST_NAME, FIRST_NAME) VALUES (?, ?, ?, ?)');
            $ins->execute([$login, $displayName, $lastName, $firstName]);
            $row = [
                'ID' => (int) $pdo->lastInsertId(),
                'LOGIN' => $login,
                'DISPLAY_NAME' => $displayName,
                'LAST_NAME' => $lastName,
                'FIRST_NAME' => $firstName,
                'PIN_HASH' => null,
            ];
        }
    } else {
        $needsUpdate = false;
        if ($lastName !== null && $lastName !== ($row['LAST_NAME'] ?? null)) {
            $row['LAST_NAME'] = $lastName;
            $needsUpdate = true;
        }
        if ($firstName !== null && $firstName !== ($row['FIRST_NAME'] ?? null)) {
            $row['FIRST_NAME'] = $firstName;
            $needsUpdate = true;
        }
        if ($displayName !== null && $displayName !== $row['DISPLAY_NAME']) {
            $row['DISPLAY_NAME'] = $displayName;
            $needsUpdate = true;
        }
        if ($needsUpdate) {
            $upd = $pdo->prepare('UPDATE TM07_OPERATOR SET DISPLAY_NAME = ?, LAST_NAME = ?, FIRST_NAME = ? WHERE ID = ?');
            $upd->execute([$row['DISPLAY_NAME'], $row['LAST_NAME'] ?? null, $row['FIRST_NAME'] ?? null, $row['ID']]);
        }
    }

    if ($bindSession) {
        $sessionRow = $row;
        unset($sessionRow['PIN_HASH']);
        $_SESSION[BENCH_SESSION_OPERATOR] = $sessionRow;
    }
    return $row;
}

function bench_require_operator_session(): array
{
    $sessionOp = $_SESSION[BENCH_SESSION_OPERATOR] ?? null;
    if (!is_array($sessionOp) || empty($sessionOp['LOGIN'])) {
        throw new RuntimeException('Требуется авторизация оператора');
    }
    return $sessionOp;
}

/**
 * Стенд калибровки: admin UI или сессия оператора.
 * @return array|null оператор из сессии (если есть), иначе null при admin-only
 */
function bench_require_operator_or_admin(): ?array
{
    if (auth_is_admin()) {
        $sessionOp = $_SESSION[BENCH_SESSION_OPERATOR] ?? null;
        return is_array($sessionOp) && !empty($sessionOp['LOGIN']) ? $sessionOp : null;
    }
    $sessionOp = $_SESSION[BENCH_SESSION_OPERATOR] ?? null;
    if (!is_array($sessionOp) || empty($sessionOp['LOGIN'])) {
        throw new RuntimeException('Требуется авторизация оператора или администратора');
    }
    return $sessionOp;
}

/**
 * Контекст для журнала/API: рабочее место из body, оператор — только из PHP-сессии
 * (не поднимать привилегии по userLogin из тела запроса).
 */
function bench_current_context(PDO $pdo, array $body = []): array
{
    $ws = bench_resolve_workstation($pdo, null, $body);
    $_SESSION[BENCH_SESSION_WORKSTATION] = (int) $ws['ID'];

    $op = bench_resolve_operator($pdo);

    return [
        'workstation' => $ws,
        'operator' => $op,
        'workstationId' => (int) $ws['ID'],
        'operatorId' => $op ? (int) $op['ID'] : null,
    ];
}

function bench_event_type_id(PDO $pdo, string $code): ?int
{
    $st = $pdo->prepare('SELECT ID FROM TM07_EVENT_TYPE WHERE CODE = ?');
    $st->execute([$code]);
    $id = $st->fetchColumn();
    return $id !== false ? (int) $id : null;
}

function bench_log_event(PDO $pdo, array $params): int
{
    $typeCode = (string) ($params['eventType'] ?? '');
    $typeId = bench_event_type_id($pdo, $typeCode);
    if ($typeId === null) {
        throw new InvalidArgumentException('Unknown event type: ' . $typeCode);
    }

    $ctx = bench_current_context($pdo, $params);
    $payload = bench_merge_session_into_payload($pdo, $params['payload'] ?? null);
    $eventParams = $params;

    $sql =
        'INSERT INTO TM07_BENCH_EVENT (EVENT_TYPE_ID, EVENT_STATE, SERIAL_CORRECTOR, SERIAL_COMPLEX, STAGE, OPERATOR_ID, WORKSTATION_ID, PAYLOAD)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
    $insertParams = [
        $typeId,
        (string) ($eventParams['eventState'] ?? 'done'),
        isset($eventParams['serialCorrector']) ? (string) $eventParams['serialCorrector'] : null,
        isset($eventParams['serialComplex']) ? (string) $eventParams['serialComplex'] : null,
        isset($eventParams['stage']) ? (string) $eventParams['stage'] : null,
        $ctx['operatorId'],
        $ctx['workstationId'],
        $payload,
    ];

    if (bench_is_firebird($pdo) || bench_is_pgsql($pdo)) {
        $st = $pdo->prepare($sql . ' RETURNING ID');
        $st->execute($insertParams);
        $id = $st->fetchColumn();
        if ($id === false) {
            throw new RuntimeException('Не удалось записать событие');
        }
        $eventId = (int) $id;
    } else {
        $st = $pdo->prepare($sql);
        $st->execute($insertParams);
        $eventId = (int) $pdo->lastInsertId();
    }

    bench_after_log_event($pdo, $typeCode, $eventParams, $eventId);

    if (function_exists('site_file_log')) {
        site_file_log('event', $typeCode, [
            'eventId' => $eventId,
            'eventState' => (string) ($eventParams['eventState'] ?? 'done'),
            'stage' => $eventParams['stage'] ?? null,
            'serialCorrector' => $eventParams['serialCorrector'] ?? null,
            'serialComplex' => $eventParams['serialComplex'] ?? null,
            'payload' => $eventParams['payload'] ?? null,
        ]);
    }

    return $eventId;
}

function bench_after_log_event(PDO $pdo, string $typeCode, array $params, int $eventId): void
{
    if ($typeCode !== 'parametrization_done') {
        return;
    }
    $sessionId = null;
    $payload = $params['payload'] ?? null;
    if (is_string($payload) && $payload !== '') {
        $decoded = json_decode($payload, true);
        if (is_array($decoded) && isset($decoded['sessionId'])) {
            $sessionId = (int) $decoded['sessionId'];
        }
    } elseif (is_array($payload) && isset($payload['sessionId'])) {
        $sessionId = (int) $payload['sessionId'];
    }
    if (!$sessionId) {
        $session = bench_get_active_order_session($pdo);
        if ($session) {
            $sessionId = (int) $session['ID'];
        }
    }
    if ($sessionId > 0) {
        bench_set_session_stage($pdo, $sessionId, 'completed');
    }
}

function bench_normalize_session_stage(string $stage): string
{
    $s = strtolower(trim($stage));
    if (in_array($s, ['assembly', 'parametrization', 'completed'], true)) {
        return $s;
    }
    return 'assembly';
}

/**
 * @param array<string,mixed> $row
 * @param array<string,mixed>|null $param
 */
function bench_session_stage_from_row(array $row, ?array $param = null): string
{
    $stage = trim((string) ($row['SESSION_STAGE'] ?? ''));
    if ($stage === 'completed') {
        return 'completed';
    }
    if ($stage === 'parametrization') {
        return 'parametrization';
    }
    // Сборка уже подтверждена (есть метка), но SESSION_STAGE забыли обновить — не требуем повторного клика.
    $assemblyAt = $row['ASSEMBLY_CONFIRMED_AT'] ?? null;
    if ($assemblyAt !== null && $assemblyAt !== '') {
        if ($param && ($param['status'] ?? '') === 'done') {
            return 'completed';
        }
        return 'parametrization';
    }
    if ($stage !== '') {
        return bench_normalize_session_stage($stage);
    }
    if ($param) {
        if (($param['status'] ?? '') === 'done') {
            return 'completed';
        }
        if (($param['status'] ?? '') === 'in_progress') {
            return 'parametrization';
        }
    }
    return 'assembly';
}

function bench_set_session_stage(PDO $pdo, int $sessionId, string $stage): void
{
    if ($sessionId <= 0) {
        return;
    }
    $stage = bench_normalize_session_stage($stage);
    $st = $pdo->prepare('UPDATE TM07_BENCH_SESSION SET SESSION_STAGE = ? WHERE ID = ?');
    $st->execute([$stage, $sessionId]);
}

function bench_confirm_assembly(PDO $pdo, array $body): array
{
    $op = bench_require_operator_session();
    $opId = (int) ($op['ID'] ?? $op['id'] ?? 0);
    $wsId = (int) ($_SESSION[BENCH_SESSION_WORKSTATION] ?? 0);
    $session = $opId > 0 && $wsId > 0
        ? bench_get_active_order_session($pdo, $wsId, $opId)
        : bench_require_order_session($pdo);
    if (!$session) {
        throw new RuntimeException('Требуется сессия заказа текущего оператора');
    }
    $sessionId = (int) $session['ID'];
    $param = bench_session_parametrization_status($session, bench_fetch_recent_param_events($pdo));
    $stage = bench_session_stage_from_row($session, $param);
    if ($stage === 'completed') {
        throw new RuntimeException('Сессия уже завершена — начните новую для другого корректора.');
    }
    if ($stage === 'parametrization') {
        $row = bench_fetch_session_by_id($pdo, $sessionId);
        return $row ? bench_session_row_to_api_enriched($pdo, $row) : bench_session_row_to_api_enriched($pdo, $session);
    }

    $serial = trim((string) ($body['serialCorrector'] ?? ''));
    if ($serial === '') {
        $serial = trim((string) ($session['SERIAL_CORRECTOR'] ?? ''));
    }
    if ($serial === '') {
        throw new InvalidArgumentException('Сначала сгенерируйте S/N корректора (300…).');
    }
    if (!preg_match('/^300\d{7}$/', $serial)) {
        throw new InvalidArgumentException('S/N корректора должен быть 10 цифр, формат 300YYMMNNN.');
    }

    $st = $pdo->prepare(
        'UPDATE TM07_BENCH_SESSION SET SESSION_STAGE = ?, SERIAL_CORRECTOR = ?, ASSEMBLY_CONFIRMED_AT = ' . bench_sql_now($pdo) . '
         WHERE ID = ?'
    );
    $st->execute(['parametrization', $serial, $sessionId]);

    try {
        bench_log_event($pdo, [
            'eventType' => 'assembly_confirm',
            'eventState' => 'done',
            'stage' => 'assembly',
            'serialCorrector' => $serial,
            'payload' => [
                'sessionId' => $sessionId,
                'orderNumber' => $session['ORDER_NUMBER'] ?? null,
                'serialCorrector' => $serial,
            ],
        ]);
    } catch (Throwable) {
        // stage already saved
    }

    $row = bench_fetch_session_by_id($pdo, $sessionId);
    if (!$row) {
        throw new RuntimeException('Сессия не найдена после подтверждения сборки');
    }

    return bench_session_row_to_api_enriched($pdo, $row);
}

function bench_serial_kind_meta(string $kind): array
{
    $map = [
        'corrector' => ['prefix' => '300', 'stepId' => 3, 'eventType' => 'serial_corrector'],
        'complex' => ['prefix' => '400', 'stepId' => 201, 'eventType' => 'serial_complex'],
    ];
    if (!isset($map[$kind])) {
        throw new InvalidArgumentException('Invalid kind, expected corrector|complex');
    }
    return $map[$kind];
}

function bench_month_key_from_date(?string $isoDate = null): array
{
    $ts = $isoDate ? strtotime($isoDate) : time();
    if ($ts === false) {
        $ts = time();
    }
    $fullYear = (int) date('Y', $ts);
    $yy = (int) date('y', $ts);
    $mm = date('m', $ts);
    return [
        'fullYear' => $fullYear,
        'yy' => $yy,
        'mm' => $mm,
        'monthKey' => sprintf('%02d%02d', $yy, (int) $mm),
    ];
}

function bench_order_number_canonical(?string $raw): string
{
    $s = trim((string) $raw);
    if ($s === '') {
        return '';
    }
    $digits = serial_xlsx_order_digits($s);
    if ($digits === '' || $digits === '0') {
        return $s;
    }
    return 'ТМ00-' . str_pad($digits, 6, '0', STR_PAD_LEFT);
}

/** Сравнение номеров заказа с учётом «539» ↔ «ТМ00-000539». */
function bench_orders_equal(?string $a, ?string $b): bool
{
    $ca = bench_order_number_canonical($a);
    $cb = bench_order_number_canonical($b);
    if ($ca !== '' && $cb !== '' && $ca === $cb) {
        return true;
    }
    $ta = trim((string) $a);
    $tb = trim((string) $b);
    return $ta !== '' && $ta === $tb;
}

/**
 * Активная сессия этого оператора по номеру заказа.
 * Предпочитает текущее рабочее место, иначе любую active того же оператора.
 */
function bench_find_active_session_by_order(
    PDO $pdo,
    string $orderNumber,
    int $operatorId,
    ?int $preferWorkstationId = null
): ?array {
    if ($operatorId <= 0 || trim($orderNumber) === '') {
        return null;
    }
    $digits = serial_xlsx_order_digits($orderNumber);
    $keys = array_values(array_unique(array_filter([
        trim($orderNumber),
        bench_order_number_canonical($orderNumber),
        $digits,
        $digits !== '' ? str_pad($digits, 6, '0', STR_PAD_LEFT) : '',
        $digits !== '' ? 'ТМ00-' . str_pad($digits, 6, '0', STR_PAD_LEFT) : '',
    ], static fn ($v) => $v !== null && $v !== '')));
    if (!$keys) {
        return null;
    }
    $placeholders = implode(',', array_fill(0, count($keys), '?'));

    $fetch = static function (PDO $pdo, string $sql, array $params): ?array {
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    };

    if ($preferWorkstationId !== null && $preferWorkstationId > 0) {
        if (bench_is_firebird($pdo)) {
            $row = $fetch(
                $pdo,
                'SELECT FIRST 1 ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                        SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
                 FROM TM07_BENCH_SESSION
                 WHERE STATE = ? AND OPERATOR_ID = ? AND WORKSTATION_ID = ?
                   AND ORDER_NUMBER IN (' . $placeholders . ')
                 ORDER BY OPENED_AT DESC',
                array_merge(['active', $operatorId, $preferWorkstationId], $keys)
            );
        } else {
            $row = $fetch(
                $pdo,
                "SELECT ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                        SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
                 FROM TM07_BENCH_SESSION
                 WHERE STATE = 'active' AND OPERATOR_ID = ? AND WORKSTATION_ID = ?
                   AND ORDER_NUMBER IN ($placeholders)
                 ORDER BY OPENED_AT DESC
                 LIMIT 1",
                array_merge([$operatorId, $preferWorkstationId], $keys)
            );
        }
        if ($row) {
            return $row;
        }
    }

    if (bench_is_firebird($pdo)) {
        return $fetch(
            $pdo,
            'SELECT FIRST 1 ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                    SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
             FROM TM07_BENCH_SESSION
             WHERE STATE = ? AND OPERATOR_ID = ?
               AND ORDER_NUMBER IN (' . $placeholders . ')
             ORDER BY OPENED_AT DESC',
            array_merge(['active', $operatorId], $keys)
        );
    }

    return $fetch(
        $pdo,
        "SELECT ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
         FROM TM07_BENCH_SESSION
         WHERE STATE = 'active' AND OPERATOR_ID = ?
           AND ORDER_NUMBER IN ($placeholders)
         ORDER BY OPENED_AT DESC
         LIMIT 1",
        array_merge([$operatorId], $keys)
    );
}

/**
 * Последняя сессия оператора по заказу (active или closed) — для повторного входа в тот же номер.
 * Active предпочтительнее закрытой; среди равных — по OPENED_AT DESC.
 */
function bench_find_latest_session_by_order(
    PDO $pdo,
    string $orderNumber,
    int $operatorId,
    ?int $preferWorkstationId = null
): ?array {
    if ($operatorId <= 0 || trim($orderNumber) === '') {
        return null;
    }
    $digits = serial_xlsx_order_digits($orderNumber);
    $keys = array_values(array_unique(array_filter([
        trim($orderNumber),
        bench_order_number_canonical($orderNumber),
        $digits,
        $digits !== '' ? str_pad($digits, 6, '0', STR_PAD_LEFT) : '',
        $digits !== '' ? 'ТМ00-' . str_pad($digits, 6, '0', STR_PAD_LEFT) : '',
    ], static fn ($v) => $v !== null && $v !== '')));
    if (!$keys) {
        return null;
    }
    $placeholders = implode(',', array_fill(0, count($keys), '?'));

    $fetch = static function (PDO $pdo, string $sql, array $params): ?array {
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    };

    // Сначала active (как bench_find_active_session_by_order), затем последняя closed.
    $active = bench_find_active_session_by_order($pdo, $orderNumber, $operatorId, $preferWorkstationId);
    if ($active) {
        return $active;
    }

    if ($preferWorkstationId !== null && $preferWorkstationId > 0) {
        if (bench_is_firebird($pdo)) {
            $row = $fetch(
                $pdo,
                'SELECT FIRST 1 ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                        SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
                 FROM TM07_BENCH_SESSION
                 WHERE STATE = ? AND OPERATOR_ID = ? AND WORKSTATION_ID = ?
                   AND ORDER_NUMBER IN (' . $placeholders . ')
                 ORDER BY OPENED_AT DESC',
                array_merge(['closed', $operatorId, $preferWorkstationId], $keys)
            );
        } else {
            $row = $fetch(
                $pdo,
                "SELECT ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                        SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
                 FROM TM07_BENCH_SESSION
                 WHERE STATE = 'closed' AND OPERATOR_ID = ? AND WORKSTATION_ID = ?
                   AND ORDER_NUMBER IN ($placeholders)
                 ORDER BY OPENED_AT DESC
                 LIMIT 1",
                array_merge([$operatorId, $preferWorkstationId], $keys)
            );
        }
        if ($row) {
            return $row;
        }
    }

    if (bench_is_firebird($pdo)) {
        return $fetch(
            $pdo,
            'SELECT FIRST 1 ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                    SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
             FROM TM07_BENCH_SESSION
             WHERE STATE = ? AND OPERATOR_ID = ?
               AND ORDER_NUMBER IN (' . $placeholders . ')
             ORDER BY OPENED_AT DESC',
            array_merge(['closed', $operatorId], $keys)
        );
    }

    return $fetch(
        $pdo,
        "SELECT ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
         FROM TM07_BENCH_SESSION
         WHERE STATE = 'closed' AND OPERATOR_ID = ?
           AND ORDER_NUMBER IN ($placeholders)
         ORDER BY OPENED_AT DESC
         LIMIT 1",
        array_merge([$operatorId], $keys)
    );
}

function bench_resolve_order_number(PDO $pdo, array $contextBody): string
{
    $orderNumber = trim((string) ($contextBody['orderNumber'] ?? ''));
    if ($orderNumber !== '') {
        return bench_order_number_canonical($orderNumber);
    }
    try {
        $ctx = bench_current_context($pdo, $contextBody);
        $active = bench_get_active_order_session($pdo, $ctx['workstationId']);
        if ($active && !empty($active['ORDER_NUMBER'])) {
            return bench_order_number_canonical((string) $active['ORDER_NUMBER']);
        }
    } catch (Throwable) {
        // нет сессии — оставляем пусто
    }
    return '';
}

function bench_serial_result(array $meta, array $parsed, string $kind, bool $dryRun, bool $reused, string $source, string $orderNumber): array
{
    $yy = (int) ($parsed['yy'] ?? substr((string) $parsed['monthKey'], 0, 2));
    return [
        'serial' => $parsed['serial'],
        'kind' => $kind,
        'prefix' => $meta['prefix'],
        'stepId' => $meta['stepId'],
        'seq' => (int) $parsed['seq'],
        'monthKey' => (string) $parsed['monthKey'],
        'fullYear' => 2000 + $yy,
        'mm' => sprintf('%02d', (int) ($parsed['mm'] ?? substr((string) $parsed['monthKey'], 2, 2))),
        'dryRun' => $dryRun,
        'reused' => $reused,
        'source' => $source,
        'orderNumber' => $orderNumber !== '' ? $orderNumber : null,
    ];
}

function bench_find_issued_for_order(PDO $pdo, string $kind, string $orderNumber): ?array
{
    $digits = serial_xlsx_order_digits($orderNumber);
    if ($digits === '') {
        return null;
    }
    $keys = array_values(array_unique(array_filter([
        $orderNumber,
        bench_order_number_canonical($orderNumber),
        $digits,
        str_pad($digits, 6, '0', STR_PAD_LEFT),
    ])));
    if ($keys === []) {
        return null;
    }
    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    if (bench_is_firebird($pdo)) {
        $sql = 'SELECT FIRST 1 SERIAL, PREFIX, MONTH_KEY, SEQ, ORDER_NUMBER FROM TM07_SERIAL_ISSUED
                WHERE KIND = ? AND ORDER_NUMBER IN (' . $placeholders . ')
                ORDER BY ID DESC';
    } else {
        $sql = 'SELECT SERIAL, PREFIX, MONTH_KEY, SEQ, ORDER_NUMBER FROM TM07_SERIAL_ISSUED
                WHERE KIND = ? AND ORDER_NUMBER IN (' . $placeholders . ')
                ORDER BY ID DESC
                LIMIT 1';
    }
    $st = $pdo->prepare($sql);
    $st->execute(array_merge([$kind], $keys));
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return null;
    }
    $parsed = serial_xlsx_parse_sn(trim((string) $row['SERIAL']));
    if (!$parsed) {
        return null;
    }
    $parsed['source'] = 'issued';
    return $parsed;
}

function bench_find_session_corrector_for_order(PDO $pdo, string $orderNumber): ?array
{
    $digits = serial_xlsx_order_digits($orderNumber);
    if ($digits === '') {
        return null;
    }
    $keys = array_values(array_unique(array_filter([
        $orderNumber,
        bench_order_number_canonical($orderNumber),
        $digits,
        str_pad($digits, 6, '0', STR_PAD_LEFT),
    ])));
    $placeholders = implode(',', array_fill(0, count($keys), '?'));
    if (bench_is_firebird($pdo)) {
        $sql = "SELECT FIRST 1 SERIAL_CORRECTOR, ORDER_NUMBER FROM TM07_BENCH_SESSION
                WHERE SERIAL_CORRECTOR IS NOT NULL AND SERIAL_CORRECTOR <> ''
                  AND ORDER_NUMBER IN ($placeholders)
                ORDER BY ID DESC";
    } else {
        $sql = "SELECT SERIAL_CORRECTOR, ORDER_NUMBER FROM TM07_BENCH_SESSION
                WHERE SERIAL_CORRECTOR IS NOT NULL AND SERIAL_CORRECTOR <> ''
                  AND ORDER_NUMBER IN ($placeholders)
                ORDER BY ID DESC
                LIMIT 1";
    }
    $st = $pdo->prepare($sql);
    $st->execute($keys);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        return null;
    }
    $parsed = serial_xlsx_parse_sn(trim((string) $row['SERIAL_CORRECTOR']));
    if (!$parsed || $parsed['kind'] !== 'corrector') {
        return null;
    }
    $parsed['source'] = 'session';
    return $parsed;
}

function bench_remember_existing_serial(PDO $pdo, array $parsed, string $kind, string $orderNumber, array $contextBody): void
{
    $ctx = bench_current_context($pdo, $contextBody);
    $payload = json_encode(['source' => $parsed['source'] ?? 'xlsx', 'reused' => true], JSON_UNESCAPED_UNICODE);
    try {
        $ins = $pdo->prepare(
            'INSERT INTO TM07_SERIAL_ISSUED (SERIAL, KIND, PREFIX, MONTH_KEY, SEQ, OPERATOR_ID, WORKSTATION_ID, ORDER_NUMBER, PAYLOAD)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $parsed['serial'],
            $kind,
            $parsed['prefix'],
            $parsed['monthKey'],
            $parsed['seq'],
            $ctx['operatorId'],
            $ctx['workstationId'],
            $orderNumber !== '' ? $orderNumber : null,
            $payload,
        ]);
    } catch (Throwable) {
        // SERIAL UNIQUE — уже есть в БД
    }
}

/**
 * @return array{serial:string,prefix:string,stepId:int,seq:int,monthKey:string,fullYear:int,mm:string,kind:string,dryRun:bool,reused:bool,source:string}
 */
function bench_allocate_serial(PDO $pdo, string $kind, ?string $isoDate, bool $dryRun, array $contextBody = []): array
{
    $meta = bench_serial_kind_meta($kind);
    $month = bench_month_key_from_date($isoDate);
    $prefix = $meta['prefix'];
    $monthKey = $month['monthKey'];
    $orderNumber = bench_resolve_order_number($pdo, $contextBody);

    // Только БД: повторная выдача по заказу из TM07_SERIAL_ISSUED.
    if ($orderNumber !== '') {
        $existing = bench_find_issued_for_order($pdo, $kind, $orderNumber);
        if ($existing) {
            return bench_serial_result($meta, $existing, $kind, $dryRun, true, 'db', $orderNumber);
        }
    }

    $lastSeq = 0;
    try {
        $stFloor = $pdo->prepare('SELECT LAST_SEQ FROM TM07_SERIAL_COUNTER WHERE PREFIX = ? AND MONTH_KEY = ?');
        $stFloor->execute([$prefix, $monthKey]);
        $fr = $stFloor->fetch(PDO::FETCH_ASSOC);
        if ($fr) {
            $lastSeq = (int) ($fr['LAST_SEQ'] ?? $fr['last_seq'] ?? 0);
        }
    } catch (Throwable) {
        $lastSeq = 0;
    }
    try {
        $stMax = $pdo->prepare(
            'SELECT MAX(SEQ) AS M FROM TM07_SERIAL_ISSUED WHERE PREFIX = ? AND MONTH_KEY = ?'
        );
        $stMax->execute([$prefix, $monthKey]);
        $mr = $stMax->fetch(PDO::FETCH_ASSOC);
        if ($mr) {
            $lastSeq = max($lastSeq, (int) ($mr['M'] ?? $mr['m'] ?? 0));
        }
    } catch (Throwable) {
        // ignore
    }

    $nextSeq = $lastSeq + 1;
    if ($nextSeq > 999) {
        throw new RuntimeException('Исчерпан диапазон порядковых номеров за месяц (999)');
    }
    $serial = sprintf('%s%s%03d', $prefix, $monthKey, $nextSeq);
    $parsed = [
        'serial' => $serial,
        'yy' => (int) substr($monthKey, 0, 2),
        'mm' => (int) substr($monthKey, 2, 2),
        'seq' => $nextSeq,
        'monthKey' => $monthKey,
        'prefix' => $prefix,
    ];

    if ($dryRun) {
        return bench_serial_result($meta, $parsed, $kind, true, false, 'db-next', $orderNumber);
    }

    bench_transaction_begin($pdo);
    try {
        // SQLite needs IMMEDIATE lock for serial counter races; pgsql/firebird use normal transactions.
        if (!bench_is_firebird($pdo) && !bench_is_pgsql($pdo)) {
            try {
                if ($pdo->inTransaction()) {
                    $pdo->commit();
                }
            } catch (Throwable) {
            }
            $pdo->exec('BEGIN IMMEDIATE');
        }

        // Повторно под lock: заказ мог получить номер параллельно.
        if ($orderNumber !== '') {
            $again = bench_find_issued_for_order($pdo, $kind, $orderNumber);
            if ($again) {
                $pdo->commit();
                return bench_serial_result($meta, $again, $kind, false, true, 'db', $orderNumber);
            }
        }

        $stFloor2 = $pdo->prepare('SELECT LAST_SEQ FROM TM07_SERIAL_COUNTER WHERE PREFIX = ? AND MONTH_KEY = ?');
        $stFloor2->execute([$prefix, $monthKey]);
        $fr2 = $stFloor2->fetch(PDO::FETCH_ASSOC);
        $lockedLast = $fr2 ? (int) ($fr2['LAST_SEQ'] ?? $fr2['last_seq'] ?? 0) : 0;
        $stMax2 = $pdo->prepare(
            'SELECT MAX(SEQ) AS M FROM TM07_SERIAL_ISSUED WHERE PREFIX = ? AND MONTH_KEY = ?'
        );
        $stMax2->execute([$prefix, $monthKey]);
        $mr2 = $stMax2->fetch(PDO::FETCH_ASSOC);
        if ($mr2) {
            $lockedLast = max($lockedLast, (int) ($mr2['M'] ?? $mr2['m'] ?? 0));
        }
        $nextSeq = $lockedLast + 1;
        if ($nextSeq > 999) {
            throw new RuntimeException('Исчерпан диапазон порядковых номеров за месяц (999)');
        }
        $serial = sprintf('%s%s%03d', $prefix, $monthKey, $nextSeq);
        $parsed = [
            'serial' => $serial,
            'yy' => (int) substr($monthKey, 0, 2),
            'mm' => (int) substr($monthKey, 2, 2),
            'seq' => $nextSeq,
            'monthKey' => $monthKey,
            'prefix' => $prefix,
        ];

        $upd = $pdo->prepare(
            'UPDATE TM07_SERIAL_COUNTER SET LAST_SEQ = ? WHERE PREFIX = ? AND MONTH_KEY = ?'
        );
        $upd->execute([$nextSeq, $prefix, $monthKey]);
        if ($upd->rowCount() === 0) {
            try {
                $ins0 = $pdo->prepare(
                    'INSERT INTO TM07_SERIAL_COUNTER (PREFIX, MONTH_KEY, LAST_SEQ) VALUES (?, ?, ?)'
                );
                $ins0->execute([$prefix, $monthKey, $nextSeq]);
            } catch (Throwable) {
                $upd->execute([$nextSeq, $prefix, $monthKey]);
            }
        }

        $ctx = bench_current_context($pdo, $contextBody);
        $payload = isset($contextBody['payload'])
            ? json_encode($contextBody['payload'], JSON_UNESCAPED_UNICODE)
            : json_encode(['source' => 'db'], JSON_UNESCAPED_UNICODE);

        $delIssued = $pdo->prepare('DELETE FROM TM07_SERIAL_ISSUED WHERE SERIAL = ?');
        $delIssued->execute([$serial]);

        $insSerial = $pdo->prepare(
            'INSERT INTO TM07_SERIAL_ISSUED (SERIAL, KIND, PREFIX, MONTH_KEY, SEQ, OPERATOR_ID, WORKSTATION_ID, ORDER_NUMBER, PAYLOAD)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $insSerial->execute([
            $serial,
            $kind,
            $prefix,
            $monthKey,
            $nextSeq,
            $ctx['operatorId'],
            $ctx['workstationId'],
            $orderNumber !== '' ? $orderNumber : null,
            $payload,
        ]);

        bench_log_event($pdo, [
            'eventType' => $meta['eventType'],
            'eventState' => 'done',
            'stage' => 'serial',
            'serialCorrector' => $kind === 'corrector' ? $serial : ($contextBody['serialCorrector'] ?? null),
            'serialComplex' => $kind === 'complex' ? $serial : ($contextBody['serialComplex'] ?? null),
            'userLogin' => $contextBody['userLogin'] ?? null,
            'userDisplayName' => $contextBody['userDisplayName'] ?? null,
            'workstationCode' => $contextBody['workstationCode'] ?? null,
            'payload' => ['serial' => $serial, 'kind' => $kind, 'orderNumber' => $orderNumber, 'source' => 'db'],
        ]);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    return bench_serial_result($meta, $parsed, $kind, false, false, 'db', $orderNumber);
}

function bench_peek_serial(PDO $pdo, string $kind, ?string $isoDate, array $contextBody = []): array
{
    return bench_allocate_serial($pdo, $kind, $isoDate, true, $contextBody);
}

function bench_session_row_to_api(array $row): array
{
    $payload = null;
    if (!empty($row['ORDER_PAYLOAD'])) {
        $decoded = json_decode((string) $row['ORDER_PAYLOAD'], true);
        if (is_array($decoded)) {
            $payload = $decoded;
        }
    }

    return [
        'id' => (int) $row['ID'],
        'orderNumber' => $row['ORDER_NUMBER'],
        'orderStatus' => $row['ORDER_STATUS'] ?? null,
        'state' => $row['STATE'] ?? 'active',
        'sessionStage' => bench_session_stage_from_row($row),
        'serialCorrector' => isset($row['SERIAL_CORRECTOR']) && $row['SERIAL_CORRECTOR'] !== ''
            ? (string) $row['SERIAL_CORRECTOR']
            : null,
        'assemblyConfirmedAt' => bench_format_ts_moscow($row['ASSEMBLY_CONFIRMED_AT'] ?? null),
        'openedAt' => bench_format_ts_moscow($row['OPENED_AT'] ?? null),
        'closedAt' => bench_format_ts_moscow($row['CLOSED_AT'] ?? null),
        'orderPayload' => $payload,
        'operatorId' => isset($row['OPERATOR_ID']) ? (int) $row['OPERATOR_ID'] : null,
        'workstationId' => (int) $row['WORKSTATION_ID'],
    ];
}

/**
 * @return list<array<string,mixed>>
 */
function bench_fetch_recent_param_events(PDO $pdo, int $limit = 500): array
{
    $limit = min(500, max(1, $limit));
    if (bench_is_firebird($pdo)) {
        $paramSql =
            "SELECT FIRST {$limit} E.ID, T.CODE AS EVENT_CODE, E.EVENT_STATE, E.SERIAL_CORRECTOR, E.SERIAL_COMPLEX,
                    E.CREATED_AT, E.WORKSTATION_ID, E.PAYLOAD
             FROM TM07_BENCH_EVENT E
             JOIN TM07_EVENT_TYPE T ON T.ID = E.EVENT_TYPE_ID
             WHERE T.CODE IN ('parametrization_start', 'parametrization_done')
             ORDER BY E.CREATED_AT DESC";
    } else {
        $paramSql =
            "SELECT E.ID, T.CODE AS EVENT_CODE, E.EVENT_STATE, E.SERIAL_CORRECTOR, E.SERIAL_COMPLEX,
                    E.CREATED_AT, E.WORKSTATION_ID, E.PAYLOAD
             FROM TM07_BENCH_EVENT E
             JOIN TM07_EVENT_TYPE T ON T.ID = E.EVENT_TYPE_ID
             WHERE T.CODE IN ('parametrization_start', 'parametrization_done')
             ORDER BY E.CREATED_AT DESC
             LIMIT {$limit}";
    }

    return $pdo->query($paramSql)->fetchAll(PDO::FETCH_ASSOC) ?: [];
}

function bench_session_row_to_api_enriched(PDO $pdo, array $row): array
{
    static $paramEventsCache = null;
    if ($paramEventsCache === null) {
        $paramEventsCache = bench_fetch_recent_param_events($pdo);
    }

    return array_merge(
        bench_session_row_to_api($row),
        [
            'sessionStage' => bench_session_stage_from_row(
                $row,
                bench_session_parametrization_status($row, $paramEventsCache)
            ),
            'parametrization' => bench_session_parametrization_status($row, $paramEventsCache),
        ]
    );
}

function bench_fetch_session_by_id(PDO $pdo, int $id): ?array
{
    $st = $pdo->prepare(
        'SELECT ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
         FROM TM07_BENCH_SESSION WHERE ID = ?'
    );
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
}

function bench_get_active_order_session(PDO $pdo, ?int $workstationId = null, ?int $operatorId = null): ?array
{
    if ($operatorId === null) {
        $sessionOp = $_SESSION[BENCH_SESSION_OPERATOR] ?? null;
        if (is_array($sessionOp) && !empty($sessionOp['ID'])) {
            $operatorId = (int) $sessionOp['ID'];
        }
    }

    $sessionId = $_SESSION[BENCH_SESSION_ORDER] ?? null;
    if ($sessionId) {
        $row = bench_fetch_session_by_id($pdo, (int) $sessionId);
        if ($row && ($row['STATE'] ?? '') === 'active') {
            $wsOk = $workstationId === null || (int) ($row['WORKSTATION_ID'] ?? 0) === (int) $workstationId;
            $opOk = $operatorId === null || (int) ($row['OPERATOR_ID'] ?? 0) === (int) $operatorId;
            if ($wsOk && $opOk) {
                return $row;
            }
            unset($_SESSION[BENCH_SESSION_ORDER]);
        } else {
            unset($_SESSION[BENCH_SESSION_ORDER]);
        }
    }

    $wsId = $workstationId ?? ($_SESSION[BENCH_SESSION_WORKSTATION] ?? null);
    if (!$wsId) {
        return null;
    }

    if ($operatorId !== null) {
        if (bench_is_firebird($pdo)) {
            $st = $pdo->prepare(
                'SELECT FIRST 1 ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                        SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
                 FROM TM07_BENCH_SESSION
                 WHERE WORKSTATION_ID = ? AND STATE = ? AND OPERATOR_ID = ?
                 ORDER BY OPENED_AT DESC'
            );
            $st->execute([(int) $wsId, 'active', (int) $operatorId]);
        } else {
            $st = $pdo->prepare(
                "SELECT ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                        SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
                 FROM TM07_BENCH_SESSION
                 WHERE WORKSTATION_ID = ? AND STATE = 'active' AND OPERATOR_ID = ?
                 ORDER BY OPENED_AT DESC
                 LIMIT 1"
            );
            $st->execute([(int) $wsId, (int) $operatorId]);
        }
    } elseif (bench_is_firebird($pdo)) {
        $st = $pdo->prepare(
            'SELECT FIRST 1 ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                    SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
             FROM TM07_BENCH_SESSION
             WHERE WORKSTATION_ID = ? AND STATE = ?
             ORDER BY OPENED_AT DESC'
        );
        $st->execute([(int) $wsId, 'active']);
    } else {
        $st = $pdo->prepare(
            "SELECT ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE,
                    SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT
             FROM TM07_BENCH_SESSION
             WHERE WORKSTATION_ID = ? AND STATE = 'active'
             ORDER BY OPENED_AT DESC
             LIMIT 1"
        );
        $st->execute([(int) $wsId]);
    }
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        $_SESSION[BENCH_SESSION_ORDER] = (int) $row['ID'];
    }

    return $row ?: null;
}

/** Закрыть active-сессии рабочего места, принадлежащие другому оператору. */
function bench_close_foreign_order_sessions(PDO $pdo, int $workstationId, int $currentOperatorId, ?string $reason = null): int
{
    $nowExpr = bench_sql_now($pdo);
    $sel = $pdo->prepare(
        "SELECT ID, ORDER_NUMBER, OPERATOR_ID FROM TM07_BENCH_SESSION
         WHERE WORKSTATION_ID = ? AND STATE = 'active' AND OPERATOR_ID <> ?"
    );
    $sel->execute([$workstationId, $currentOperatorId]);
    $rows = $sel->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if (!$rows) {
        return 0;
    }

    $upd = $pdo->prepare(
        "UPDATE TM07_BENCH_SESSION SET STATE = 'closed', CLOSED_AT = {$nowExpr}
         WHERE WORKSTATION_ID = ? AND STATE = 'active' AND OPERATOR_ID <> ?"
    );
    $upd->execute([$workstationId, $currentOperatorId]);

    $phpSessionId = (int) ($_SESSION[BENCH_SESSION_ORDER] ?? 0);
    foreach ($rows as $row) {
        if ($phpSessionId === (int) $row['ID']) {
            unset($_SESSION[BENCH_SESSION_ORDER]);
        }
        try {
            bench_log_event($pdo, [
                'eventType' => 'order_session_close',
                'eventState' => 'done',
                'stage' => 'order',
                'payload' => [
                    'sessionId' => (int) $row['ID'],
                    'orderNumber' => $row['ORDER_NUMBER'],
                    'reason' => $reason ?: 'operator_switch',
                    'previousOperatorId' => (int) ($row['OPERATOR_ID'] ?? 0),
                ],
            ]);
        } catch (Throwable) {
            // журнал необязателен
        }
    }

    return count($rows);
}

function bench_normalize_order_payload($payload): ?string
{
    if (!is_array($payload) && !is_object($payload)) {
        return null;
    }
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return null;
    }
    if (strlen($json) > 4096) {
        $json = substr($json, 0, 4093) . '...';
    }

    return $json;
}

function bench_close_active_order_sessions(
    PDO $pdo,
    int $workstationId,
    ?string $reason = null,
    ?int $operatorId = null
): int {
    $nowExpr = bench_sql_now($pdo);
    if ($operatorId !== null && $operatorId > 0) {
        $sel = $pdo->prepare(
            "SELECT ID, ORDER_NUMBER FROM TM07_BENCH_SESSION
             WHERE WORKSTATION_ID = ? AND STATE = 'active' AND OPERATOR_ID = ?"
        );
        $sel->execute([$workstationId, $operatorId]);
    } else {
        $sel = $pdo->prepare(
            "SELECT ID, ORDER_NUMBER FROM TM07_BENCH_SESSION WHERE WORKSTATION_ID = ? AND STATE = 'active'"
        );
        $sel->execute([$workstationId]);
    }
    $rows = $sel->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if (!$rows) {
        return 0;
    }

    if ($operatorId !== null && $operatorId > 0) {
        $upd = $pdo->prepare(
            "UPDATE TM07_BENCH_SESSION SET STATE = 'closed', CLOSED_AT = {$nowExpr}
             WHERE WORKSTATION_ID = ? AND STATE = 'active' AND OPERATOR_ID = ?"
        );
        $upd->execute([$workstationId, $operatorId]);
    } else {
        $upd = $pdo->prepare(
            "UPDATE TM07_BENCH_SESSION SET STATE = 'closed', CLOSED_AT = {$nowExpr} WHERE WORKSTATION_ID = ? AND STATE = 'active'"
        );
        $upd->execute([$workstationId]);
    }
    unset($_SESSION[BENCH_SESSION_ORDER]);

    foreach ($rows as $row) {
        try {
            bench_log_event($pdo, [
                'eventType' => 'order_session_close',
                'eventState' => 'done',
                'stage' => 'order',
                'payload' => [
                    'sessionId' => (int) $row['ID'],
                    'orderNumber' => $row['ORDER_NUMBER'],
                    'reason' => $reason,
                ],
            ]);
        } catch (Throwable) {
            // журнал необязателен
        }
    }

    return count($rows);
}

/** Закрыть «зависшие» active-сессии старше N часов (все рабочие места). */
function bench_close_stale_active_sessions(PDO $pdo, int $olderThanHours = 1): int
{
    $olderThanHours = max(1, min(720, $olderThanHours));
    $nowExpr = bench_sql_now($pdo);

    if (bench_is_firebird($pdo)) {
        $sel = $pdo->query(
            "SELECT ID, WORKSTATION_ID, ORDER_NUMBER FROM TM07_BENCH_SESSION
             WHERE STATE = 'active'
               AND OPENED_AT < DATEADD(-{$olderThanHours} HOUR TO CURRENT_TIMESTAMP)"
        );
    } elseif (bench_is_pgsql($pdo)) {
        $sel = $pdo->prepare(
            "SELECT ID, WORKSTATION_ID, ORDER_NUMBER FROM TM07_BENCH_SESSION
             WHERE STATE = 'active'
               AND OPENED_AT < CURRENT_TIMESTAMP - make_interval(hours => ?)"
        );
        $sel->execute([$olderThanHours]);
    } else {
        $sel = $pdo->prepare(
            "SELECT ID, WORKSTATION_ID, ORDER_NUMBER FROM TM07_BENCH_SESSION
             WHERE STATE = 'active'
               AND OPENED_AT < datetime('now', '-' || ? || ' hours')"
        );
        $sel->execute([$olderThanHours]);
    }
    $rows = $sel->fetchAll(PDO::FETCH_ASSOC) ?: [];
    if (!$rows) {
        return 0;
    }

    if (bench_is_firebird($pdo)) {
        $pdo->exec(
            "UPDATE TM07_BENCH_SESSION SET STATE = 'closed', CLOSED_AT = CURRENT_TIMESTAMP
             WHERE STATE = 'active'
               AND OPENED_AT < DATEADD(-{$olderThanHours} HOUR TO CURRENT_TIMESTAMP)"
        );
    } elseif (bench_is_pgsql($pdo)) {
        $upd = $pdo->prepare(
            "UPDATE TM07_BENCH_SESSION SET STATE = 'closed', CLOSED_AT = {$nowExpr}
             WHERE STATE = 'active'
               AND OPENED_AT < CURRENT_TIMESTAMP - make_interval(hours => ?)"
        );
        $upd->execute([$olderThanHours]);
    } else {
        $upd = $pdo->prepare(
            "UPDATE TM07_BENCH_SESSION SET STATE = 'closed', CLOSED_AT = {$nowExpr}
             WHERE STATE = 'active'
               AND OPENED_AT < datetime('now', '-' || ? || ' hours')"
        );
        $upd->execute([$olderThanHours]);
    }

    foreach ($rows as $row) {
        try {
            bench_log_event($pdo, [
                'eventType' => 'order_session_close',
                'eventState' => 'done',
                'stage' => 'order',
                'payload' => [
                    'sessionId' => (int) $row['ID'],
                    'orderNumber' => $row['ORDER_NUMBER'],
                    'reason' => 'stale_cleanup',
                    'workstationId' => (int) $row['WORKSTATION_ID'],
                ],
            ]);
        } catch (Throwable) {
            // журнал необязателен
        }
    }

    return count($rows);
}

function bench_open_order_session(PDO $pdo, array $body): array
{
    $op = bench_require_operator_session();
    $sessionId = (int) ($body['sessionId'] ?? $body['session_id'] ?? 0);
    if ($sessionId > 0) {
        $row = bench_reopen_order_session($pdo, $sessionId, $body);
        $row['__reused'] = true;
        return $row;
    }

    $orderRaw = trim((string) ($body['orderNumber'] ?? ''));
    if ($orderRaw === '') {
        throw new InvalidArgumentException('orderNumber обязателен');
    }
    $orderNumber = bench_order_number_canonical($orderRaw);
    if ($orderNumber === '') {
        $orderNumber = $orderRaw;
    }

    $ws = bench_register_client_workstation($pdo, $body);
    $wsId = (int) $ws['ID'];
    $opId = (int) $op['ID'];

    $forceNew = !empty($body['forceNewSession']) || !empty($body['force_new_session']);

    // Тот же номер заказа → всегда в существующую сессию (active или последнюю closed),
    // а не INSERT новой. Новая строка — только forceNewSession или если сессий по заказу не было.
    if (!$forceNew) {
        $existing = bench_find_latest_session_by_order($pdo, $orderNumber, $opId, $wsId);
        if ($existing) {
            $bodyReuse = $body;
            $bodyReuse['orderNumber'] = $orderNumber;
            $row = bench_reopen_order_session($pdo, (int) $existing['ID'], $bodyReuse);
            $row['__reused'] = true;
            return $row;
        }
    }

    $active = bench_get_active_order_session($pdo, $wsId, $opId);
    if ($active && bench_orders_equal((string) ($active['ORDER_NUMBER'] ?? ''), $orderNumber)) {
        $_SESSION[BENCH_SESSION_ORDER] = (int) $active['ID'];
        $active['__reused'] = true;
        return $active;
    }

    bench_close_active_order_sessions($pdo, $wsId, 'switch_order');

    $orderStatus = trim((string) ($body['orderStatus'] ?? ''));
    if ($orderStatus === '') {
        $orderStatus = null;
    }
    $payloadJson = bench_normalize_order_payload($body['orderPayload'] ?? null);
    $nowExpr = bench_sql_now($pdo);

    if (bench_is_firebird($pdo) || bench_is_pgsql($pdo)) {
        $ins = $pdo->prepare(
            'INSERT INTO TM07_BENCH_SESSION (ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE, SESSION_STAGE, OPENED_AT)
             VALUES (?, ?, ?, ?, ?, ?, ?, ' . $nowExpr . ')
             RETURNING ID, ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE, SESSION_STAGE, SERIAL_CORRECTOR, ASSEMBLY_CONFIRMED_AT, OPENED_AT, CLOSED_AT'
        );
        $ins->execute([$orderNumber, $orderStatus, $opId, $wsId, $payloadJson, 'active', 'assembly']);
        $row = $ins->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            throw new RuntimeException('Не удалось открыть сессию заказа');
        }
    } else {
        $ins = $pdo->prepare(
            "INSERT INTO TM07_BENCH_SESSION (ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE, SESSION_STAGE, OPENED_AT)
             VALUES (?, ?, ?, ?, ?, 'active', 'assembly', {$nowExpr})"
        );
        $ins->execute([$orderNumber, $orderStatus, $opId, $wsId, $payloadJson]);
        $row = bench_fetch_session_by_id($pdo, (int) $pdo->lastInsertId());
        if (!$row) {
            throw new RuntimeException('Не удалось открыть сессию заказа');
        }
    }

    $_SESSION[BENCH_SESSION_ORDER] = (int) $row['ID'];

    try {
        bench_log_event($pdo, [
            'eventType' => 'order_session_open',
            'eventState' => 'done',
            'stage' => 'order',
            'payload' => [
                'sessionId' => (int) $row['ID'],
                'orderNumber' => $orderNumber,
                'orderStatus' => $orderStatus,
                'reopened' => false,
            ],
        ]);
    } catch (Throwable) {
        // login succeeds even if event log fails
    }

    return $row;
}

/**
 * Реактивировать закрытую (или уже active) сессию по ID — без создания новой строки.
 */
function bench_reopen_order_session(PDO $pdo, int $sessionId, array $body = []): array
{
    $op = bench_require_operator_session();
    $row = bench_fetch_session_by_id($pdo, $sessionId);
    if (!$row) {
        throw new InvalidArgumentException('Сессия #' . $sessionId . ' не найдена');
    }

    $requestedOrder = trim((string) ($body['orderNumber'] ?? ''));
    if ($requestedOrder !== '' && !bench_orders_equal((string) ($row['ORDER_NUMBER'] ?? ''), $requestedOrder)) {
        throw new InvalidArgumentException(
            'Сессия #' . $sessionId . ' относится к заказу ' . ($row['ORDER_NUMBER'] ?? '') .
            ', а не к ' . $requestedOrder
        );
    }

    $ws = bench_register_client_workstation($pdo, $body);
    $wsId = (int) $ws['ID'];
    $opId = (int) $op['ID'];

    $state = (string) ($row['STATE'] ?? '');
    $forceTakeover = !empty($body['forceTakeover']) || !empty($body['force_takeover']);
    $rowOpId = (int) ($row['OPERATOR_ID'] ?? 0);
    $rowWsId = (int) ($row['WORKSTATION_ID'] ?? 0);

    if ($state === 'active') {
        // Чужую (другого оператора) активную сессию нельзя тихо «перехватить».
        // Тот же оператор на другом fingerprint/стенде — просто переносим сессию сюда.
        if ($rowOpId > 0 && $rowOpId !== $opId) {
            if (!$forceTakeover) {
                throw new RuntimeException(
                    'Сессия #' . $sessionId . ' уже активна у другого оператора. ' .
                    'Передайте forceTakeover=true для явного перехвата.'
                );
            }
        }
        if ($rowWsId !== $wsId || $rowOpId !== $opId) {
            bench_close_active_order_sessions($pdo, $wsId, 'switch_order');
            $upd = $pdo->prepare(
                'UPDATE TM07_BENCH_SESSION SET OPERATOR_ID = ?, WORKSTATION_ID = ?, CLOSED_AT = NULL WHERE ID = ?'
            );
            $upd->execute([$opId, $wsId, $sessionId]);
            $row = bench_fetch_session_by_id($pdo, $sessionId) ?: $row;
            try {
                bench_log_event($pdo, [
                    'eventType' => 'order_session_open',
                    'eventState' => 'done',
                    'stage' => 'order',
                    'payload' => [
                        'sessionId' => $sessionId,
                        'orderNumber' => $row['ORDER_NUMBER'] ?? null,
                        'takeover' => $rowOpId !== $opId,
                        'movedWorkstation' => $rowWsId !== $wsId,
                        'previousOperatorId' => $rowOpId,
                        'previousWorkstationId' => $rowWsId,
                    ],
                ]);
            } catch (Throwable) {
            }
        }
        $_SESSION[BENCH_SESSION_ORDER] = $sessionId;

        return $row;
    }

    if ($state !== 'closed') {
        throw new RuntimeException('Сессию в состоянии «' . $state . '» нельзя открыть');
    }

    bench_close_active_order_sessions($pdo, $wsId, 'switch_order');

    $orderStatus = trim((string) ($body['orderStatus'] ?? ''));
    if ($orderStatus === '') {
        $orderStatus = isset($row['ORDER_STATUS']) ? (string) $row['ORDER_STATUS'] : null;
        if ($orderStatus === '') {
            $orderStatus = null;
        }
    }
    $payloadJson = bench_normalize_order_payload($body['orderPayload'] ?? null);
    if ($payloadJson === null && isset($row['ORDER_PAYLOAD'])) {
        $payloadJson = is_string($row['ORDER_PAYLOAD']) ? $row['ORDER_PAYLOAD'] : null;
    }

    if (bench_is_firebird($pdo)) {
        $upd = $pdo->prepare(
            'UPDATE TM07_BENCH_SESSION
             SET STATE = ?, CLOSED_AT = NULL, OPERATOR_ID = ?, WORKSTATION_ID = ?,
                 ORDER_STATUS = ?, ORDER_PAYLOAD = ?
             WHERE ID = ?'
        );
        $upd->execute(['active', $opId, $wsId, $orderStatus, $payloadJson, $sessionId]);
    } else {
        $upd = $pdo->prepare(
            "UPDATE TM07_BENCH_SESSION
             SET STATE = 'active', CLOSED_AT = NULL, OPERATOR_ID = ?, WORKSTATION_ID = ?,
                 ORDER_STATUS = ?, ORDER_PAYLOAD = ?
             WHERE ID = ?"
        );
        $upd->execute([$opId, $wsId, $orderStatus, $payloadJson, $sessionId]);
    }

    $row = bench_fetch_session_by_id($pdo, $sessionId);
    if (!$row || ($row['STATE'] ?? '') !== 'active') {
        throw new RuntimeException('Не удалось открыть сессию #' . $sessionId);
    }

    $_SESSION[BENCH_SESSION_ORDER] = $sessionId;

    try {
        bench_log_event($pdo, [
            'eventType' => 'order_session_open',
            'eventState' => 'done',
            'stage' => 'order',
            'payload' => [
                'sessionId' => $sessionId,
                'orderNumber' => $row['ORDER_NUMBER'] ?? null,
                'reopened' => true,
                'sessionStage' => $row['SESSION_STAGE'] ?? null,
            ],
        ]);
    } catch (Throwable) {
        // журнал необязателен
    }

    return $row;
}

function bench_close_order_session(PDO $pdo, ?string $reason = null): bool
{
    $op = bench_require_operator_session();
    $wsId = $_SESSION[BENCH_SESSION_WORKSTATION] ?? null;
    if (!$wsId) {
        unset($_SESSION[BENCH_SESSION_ORDER]);

        return false;
    }
    $operatorId = (int) ($op['ID'] ?? $op['id'] ?? 0);
    $closed = bench_close_active_order_sessions(
        $pdo,
        (int) $wsId,
        $reason ?: 'manual',
        $operatorId > 0 ? $operatorId : null
    );

    return $closed > 0;
}

function bench_require_order_session(PDO $pdo): array
{
    $row = bench_get_active_order_session($pdo);
    if (!$row) {
        throw new RuntimeException('Требуется сессия заказа — введите номер и откройте заказ');
    }

    return $row;
}

function bench_merge_session_into_payload(PDO $pdo, $payload): ?string
{
    $session = bench_get_active_order_session($pdo);
    $arr = [];
    if (is_string($payload) && $payload !== '') {
        $decoded = json_decode($payload, true);
        $arr = is_array($decoded) ? $decoded : ['raw' => $payload];
    } elseif (is_array($payload)) {
        $arr = $payload;
    }
    if ($session) {
        if (!isset($arr['orderNumber'])) {
            $arr['orderNumber'] = $session['ORDER_NUMBER'];
        }
        if (!isset($arr['sessionId'])) {
            $arr['sessionId'] = (int) $session['ID'];
        }
    }

    return $arr === [] ? null : json_encode($arr, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function bench_decode_event_payload(?string $json): array
{
    if ($json === null || $json === '') {
        return [];
    }
    $decoded = json_decode($json, true);

    return is_array($decoded) ? $decoded : [];
}

function bench_event_ts(?string $iso): ?int
{
    if ($iso === null || $iso === '') {
        return null;
    }
    $ts = strtotime($iso);

    return $ts === false ? null : $ts;
}

function bench_session_matches_event(array $session, array $event): bool
{
    $payload = bench_decode_event_payload(isset($event['PAYLOAD']) ? (string) $event['PAYLOAD'] : null);
    if (isset($payload['sessionId']) && (int) $payload['sessionId'] === (int) $session['ID']) {
        return true;
    }
    if (($payload['orderNumber'] ?? '') !== ($session['ORDER_NUMBER'] ?? '')) {
        return false;
    }
    if ((int) ($event['WORKSTATION_ID'] ?? 0) !== (int) ($session['WORKSTATION_ID'] ?? 0)) {
        return false;
    }
    $eventTs = bench_event_ts(isset($event['CREATED_AT']) ? (string) $event['CREATED_AT'] : null);
    $openTs = bench_event_ts(isset($session['OPENED_AT']) ? (string) $session['OPENED_AT'] : null);
    if ($eventTs === null || $openTs === null || $eventTs < $openTs) {
        return false;
    }
    $closeRaw = $session['CLOSED_AT'] ?? null;
    if ($closeRaw !== null && $closeRaw !== '') {
        $closeTs = bench_event_ts((string) $closeRaw);
        if ($closeTs !== null && $eventTs > $closeTs + 120) {
            return false;
        }
    }

    return true;
}

/**
 * @return array{status:string,startedAt:?string,completedAt:?string,serialCorrector:?string,serialComplex:?string}
 */
function bench_session_parametrization_status(array $session, array $paramEvents): array
{
    $startedAt = null;
    $completedAt = null;
    $serialCorrector = null;
    $serialComplex = null;
    $hasStart = false;
    $hasDone = false;

    foreach ($paramEvents as $event) {
        if (!bench_session_matches_event($session, $event)) {
            continue;
        }
        $code = (string) ($event['EVENT_CODE'] ?? '');
        $created = isset($event['CREATED_AT']) ? (string) $event['CREATED_AT'] : null;
        if ($code === 'parametrization_start') {
            $hasStart = true;
            if ($startedAt === null || ($created !== null && $created < $startedAt)) {
                $startedAt = $created;
            }
        }
        if ($code === 'parametrization_done') {
            $hasDone = true;
            if ($completedAt === null || ($created !== null && $created > $completedAt)) {
                $completedAt = $created;
                $serialCorrector = isset($event['SERIAL_CORRECTOR']) ? (string) $event['SERIAL_CORRECTOR'] : null;
                $serialComplex = isset($event['SERIAL_COMPLEX']) ? (string) $event['SERIAL_COMPLEX'] : null;
                if ($serialCorrector === '') {
                    $serialCorrector = null;
                }
                if ($serialComplex === '') {
                    $serialComplex = null;
                }
            }
        }
    }

    $status = 'none';
    if ($hasDone) {
        $status = 'done';
    } elseif ($hasStart) {
        $status = 'in_progress';
    }

    return [
        'status' => $status,
        'startedAt' => $startedAt,
        'completedAt' => $completedAt,
        'serialCorrector' => $serialCorrector,
        'serialComplex' => $serialComplex,
    ];
}

function bench_operator_api_from_row(?array $row): ?array
{
    if (!$row || empty($row['OP_ID'])) {
        return null;
    }

    return [
        'id' => (int) $row['OP_ID'],
        'login' => $row['LOGIN'] ?? null,
        'displayName' => $row['DISPLAY_NAME'] ?? null,
        'lastName' => $row['LAST_NAME'] ?? null,
        'firstName' => $row['FIRST_NAME'] ?? null,
    ];
}

function bench_workstation_api_from_row(?array $row): ?array
{
    if (!$row || empty($row['WS_ID'])) {
        return null;
    }

    return [
        'id' => (int) $row['WS_ID'],
        'code' => $row['WS_CODE'] ?? null,
        'name' => $row['WS_NAME'] ?? null,
    ];
}

/**
 * @return list<array<string,mixed>>
 */
function bench_list_order_sessions(PDO $pdo, array $opts = []): array
{
    $limit = min(100, max(1, (int) ($opts['limit'] ?? 50)));
    $state = isset($opts['state']) ? trim((string) $opts['state']) : '';
    $where = ['1=1'];
    $params = [];
    if ($state === 'active' || $state === 'closed') {
        $where[] = 'S.STATE = ?';
        $params[] = $state;
    }

    if (bench_is_firebird($pdo)) {
        $sql = 'SELECT FIRST ' . $limit . ' S.ID, S.ORDER_NUMBER, S.ORDER_STATUS, S.STATE, S.SESSION_STAGE, S.SERIAL_CORRECTOR, S.ASSEMBLY_CONFIRMED_AT,
                S.OPENED_AT, S.CLOSED_AT, S.ORDER_PAYLOAD,
                S.OPERATOR_ID, S.WORKSTATION_ID,
                O.ID AS OP_ID, O.LOGIN, O.DISPLAY_NAME, O.LAST_NAME, O.FIRST_NAME,
                W.ID AS WS_ID, W.CODE AS WS_CODE, W.NAME AS WS_NAME
         FROM TM07_BENCH_SESSION S
         LEFT JOIN TM07_OPERATOR O ON O.ID = S.OPERATOR_ID
         LEFT JOIN TM07_WORKSTATION W ON W.ID = S.WORKSTATION_ID
         WHERE ' . implode(' AND ', $where) . '
         ORDER BY S.OPENED_AT DESC';
    } else {
        $sql =
            'SELECT S.ID, S.ORDER_NUMBER, S.ORDER_STATUS, S.STATE, S.SESSION_STAGE, S.SERIAL_CORRECTOR, S.ASSEMBLY_CONFIRMED_AT,
                S.OPENED_AT, S.CLOSED_AT, S.ORDER_PAYLOAD,
                S.OPERATOR_ID, S.WORKSTATION_ID,
                O.ID AS OP_ID, O.LOGIN, O.DISPLAY_NAME, O.LAST_NAME, O.FIRST_NAME,
                W.ID AS WS_ID, W.CODE AS WS_CODE, W.NAME AS WS_NAME
         FROM TM07_BENCH_SESSION S
         LEFT JOIN TM07_OPERATOR O ON O.ID = S.OPERATOR_ID
         LEFT JOIN TM07_WORKSTATION W ON W.ID = S.WORKSTATION_ID
         WHERE ' . implode(' AND ', $where) . '
         ORDER BY S.OPENED_AT DESC
         LIMIT ' . $limit;
    }

    $st = $pdo->prepare($sql);
    $st->execute($params);
    $sessions = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $paramEvents = bench_fetch_recent_param_events($pdo);

    $stageLabels = [
        'assembly' => 'Сборка',
        'parametrization' => 'Параметризация',
        'completed' => 'Завершена',
    ];

    $out = [];
    foreach ($sessions as $row) {
        $param = bench_session_parametrization_status($row, $paramEvents);
        $orderNumber = (string) $row['ORDER_NUMBER'];
        $stage = bench_session_stage_from_row($row, $param);
        $serial =
            isset($row['SERIAL_CORRECTOR']) && $row['SERIAL_CORRECTOR'] !== ''
                ? (string) $row['SERIAL_CORRECTOR']
                : ($param['serialCorrector'] ?? null);
        $resumeUrl =
            '/tm07-workbench.html?order=' .
            rawurlencode($orderNumber) .
            '&sessionId=' .
            (int) $row['ID'];
        // Завершённая сессия — открытие для сверки опросом, не для новой записи.
        if ($stage === 'completed') {
            $resumeUrl .= '&verify=1';
        }
        $out[] = [
            'id' => (int) $row['ID'],
            'orderNumber' => $orderNumber,
            'orderStatus' => $row['ORDER_STATUS'] ?? null,
            'state' => $row['STATE'] ?? 'active',
            'sessionStage' => $stage,
            'sessionStageLabel' => $stageLabels[$stage] ?? $stage,
            'serialCorrector' => $serial,
            'openedAt' => bench_format_ts_moscow($row['OPENED_AT'] ?? null),
            'closedAt' => bench_format_ts_moscow($row['CLOSED_AT'] ?? null),
            'operator' => bench_operator_api_from_row($row),
            'workstation' => bench_workstation_api_from_row($row),
            'parametrization' => $param,
            'resumeUrl' => $resumeUrl,
            'verifyMode' => $stage === 'completed',
        ];
    }

    return $out;
}

function bench_detach_session_dependencies(PDO $pdo, ?int $sessionId = null): void
{
    // Привязки датчиков храним; ссылку на сессию обнуляем, иначе FK блокирует DELETE.
    try {
        if ($sessionId !== null && $sessionId > 0) {
            $st = $pdo->prepare('UPDATE TM07_CORRECTOR_SENSOR SET SESSION_ID = NULL WHERE SESSION_ID = ?');
            $st->execute([$sessionId]);
        } else {
            $pdo->exec('UPDATE TM07_CORRECTOR_SENSOR SET SESSION_ID = NULL WHERE SESSION_ID IS NOT NULL');
        }
    } catch (Throwable) {
        // таблицы может не быть на старых БД
    }
}

function bench_delete_order_session(PDO $pdo, int $sessionId, bool $asAdmin = false): bool
{
    if ($sessionId <= 0) {
        throw new InvalidArgumentException('sessionId обязателен');
    }
    $row = bench_fetch_session_by_id($pdo, $sessionId);
    if (!$row) {
        throw new InvalidArgumentException('Сессия не найдена');
    }

    $admin = $asAdmin || auth_is_admin();
    if (!$admin) {
        $op = bench_require_operator_session();
        $opId = (int) ($op['ID'] ?? 0);
        $rowOpId = (int) ($row['OPERATOR_ID'] ?? 0);
        if ($rowOpId > 0 && $opId > 0 && $rowOpId !== $opId) {
            throw new RuntimeException('Удалить можно только свою сессию (оператор #' . $rowOpId . ')');
        }
    }

    bench_detach_session_dependencies($pdo, $sessionId);

    $st = $pdo->prepare('DELETE FROM TM07_BENCH_SESSION WHERE ID = ?');
    $st->execute([$sessionId]);

    if ((int) ($_SESSION[BENCH_SESSION_ORDER] ?? 0) === $sessionId) {
        unset($_SESSION[BENCH_SESSION_ORDER]);
    }

    return true;
}

/** Админ: удалить все сессии заказов. @return int число удалённых строк */
function bench_admin_delete_all_sessions(PDO $pdo): int
{
    if (!auth_is_admin()) {
        throw new RuntimeException('Требуется вход администратора');
    }
    $st = $pdo->query('SELECT COUNT(*) AS C FROM TM07_BENCH_SESSION');
    $row = $st ? $st->fetch(PDO::FETCH_ASSOC) : null;
    $count = (int) ($row['C'] ?? $row['c'] ?? 0);
    bench_detach_session_dependencies($pdo, null);
    $pdo->exec('DELETE FROM TM07_BENCH_SESSION');
    unset($_SESSION[BENCH_SESSION_ORDER]);

    return $count;
}

/**
 * Админ: список выданных серийных номеров.
 *
 * @return list<array<string,mixed>>
 */
function bench_admin_list_serials(PDO $pdo, int $limit = 50, ?string $q = null): array
{
    if (!auth_is_admin()) {
        throw new RuntimeException('Требуется вход администратора');
    }
    $limit = max(1, min(200, $limit));
    $q = $q !== null ? trim($q) : '';
    $params = [];
    $where = '';
    if ($q !== '') {
        $where = ' WHERE (SERIAL LIKE ? OR ORDER_NUMBER LIKE ? OR KIND LIKE ?)';
        $like = '%' . $q . '%';
        $params = [$like, $like, $like];
    }
    if (bench_is_firebird($pdo)) {
        $sql =
            'SELECT FIRST ' .
            $limit .
            ' ID, SERIAL, KIND, PREFIX, MONTH_KEY, SEQ, ORDER_NUMBER, ISSUED_AT
             FROM TM07_SERIAL_ISSUED' .
            $where .
            ' ORDER BY ISSUED_AT DESC';
    } else {
        $sql =
            'SELECT ID, SERIAL, KIND, PREFIX, MONTH_KEY, SEQ, ORDER_NUMBER, ISSUED_AT
             FROM TM07_SERIAL_ISSUED' .
            $where .
            ' ORDER BY ISSUED_AT DESC LIMIT ' .
            $limit;
    }
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $out = [];
    while ($row = $st->fetch(PDO::FETCH_ASSOC)) {
        $out[] = [
            'id' => (int) ($row['ID'] ?? $row['id'] ?? 0),
            'serial' => trim((string) ($row['SERIAL'] ?? $row['serial'] ?? '')),
            'kind' => (string) ($row['KIND'] ?? $row['kind'] ?? ''),
            'prefix' => trim((string) ($row['PREFIX'] ?? $row['prefix'] ?? '')),
            'monthKey' => trim((string) ($row['MONTH_KEY'] ?? $row['month_key'] ?? '')),
            'seq' => (int) ($row['SEQ'] ?? $row['seq'] ?? 0),
            'orderNumber' => (string) ($row['ORDER_NUMBER'] ?? $row['order_number'] ?? ''),
            'issuedAt' => (string) ($row['ISSUED_AT'] ?? $row['issued_at'] ?? ''),
        ];
    }
    return $out;
}

/**
 * Админ: удалить выданный S/N из TM07_SERIAL_ISSUED (+ очистить ссылки в сессиях/датчиках).
 *
 * @return array{serial:string, deleted:bool, clearedSessions:int, clearedSensors:int}
 */
function bench_admin_delete_serial(PDO $pdo, string $serial): array
{
    if (!auth_is_admin()) {
        throw new RuntimeException('Требуется вход администратора');
    }
    $serial = trim($serial);
    if ($serial === '') {
        throw new InvalidArgumentException('serial обязателен');
    }

    $st = $pdo->prepare('SELECT ID, SERIAL, KIND, ORDER_NUMBER FROM TM07_SERIAL_ISSUED WHERE SERIAL = ?');
    $st->execute([$serial]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        // Иногда CHAR(10) с пробелами — пробуем trim-сравнение через LIKE точного номера
        $st2 = $pdo->prepare('SELECT ID, SERIAL, KIND, ORDER_NUMBER FROM TM07_SERIAL_ISSUED WHERE TRIM(SERIAL) = ?');
        $st2->execute([$serial]);
        $row = $st2->fetch(PDO::FETCH_ASSOC);
    }
    if (!$row) {
        throw new InvalidArgumentException('Серийный номер не найден: ' . $serial);
    }
    $canon = trim((string) ($row['SERIAL'] ?? $serial));

    $clearedSessions = 0;
    $clearedSensors = 0;
    try {
        $u = $pdo->prepare('UPDATE TM07_BENCH_SESSION SET SERIAL_CORRECTOR = NULL WHERE TRIM(SERIAL_CORRECTOR) = ?');
        $u->execute([$canon]);
        $clearedSessions = $u->rowCount();
    } catch (Throwable) {
        try {
            $u = $pdo->prepare('UPDATE TM07_BENCH_SESSION SET SERIAL_CORRECTOR = NULL WHERE SERIAL_CORRECTOR = ?');
            $u->execute([$canon]);
            $clearedSessions = $u->rowCount();
        } catch (Throwable) {
        }
    }
    try {
        $d = $pdo->prepare('DELETE FROM TM07_CORRECTOR_SENSOR WHERE TRIM(SERIAL_CORRECTOR) = ?');
        $d->execute([$canon]);
        $clearedSensors = $d->rowCount();
    } catch (Throwable) {
        try {
            $d = $pdo->prepare('DELETE FROM TM07_CORRECTOR_SENSOR WHERE SERIAL_CORRECTOR = ?');
            $d->execute([$canon]);
            $clearedSensors = $d->rowCount();
        } catch (Throwable) {
        }
    }

    $del = $pdo->prepare('DELETE FROM TM07_SERIAL_ISSUED WHERE ID = ?');
    $del->execute([(int) ($row['ID'] ?? 0)]);
    if ($del->rowCount() === 0) {
        $del2 = $pdo->prepare('DELETE FROM TM07_SERIAL_ISSUED WHERE SERIAL = ?');
        $del2->execute([$canon]);
    }

    return [
        'serial' => $canon,
        'deleted' => true,
        'clearedSessions' => $clearedSessions,
        'clearedSensors' => $clearedSensors,
    ];
}

/**
 * Админ: удалить оператора. Ссылки в сессиях/событиях/S/N обнуляются.
 *
 * @return array{id:int, displayName:string}
 */
function bench_admin_delete_operator(PDO $pdo, int $operatorId): array
{
    if (!auth_is_admin()) {
        throw new RuntimeException('Требуется вход администратора');
    }
    if ($operatorId <= 0) {
        throw new InvalidArgumentException('operatorId обязателен');
    }
    $cols = bench_operator_select_cols();
    $st = $pdo->prepare("SELECT {$cols} FROM TM07_OPERATOR WHERE ID = ?");
    $st->execute([$operatorId]);
    $op = $st->fetch(PDO::FETCH_ASSOC);
    if (!$op) {
        throw new InvalidArgumentException('Оператор не найден');
    }

    foreach (
        [
            'UPDATE TM07_BENCH_SESSION SET OPERATOR_ID = NULL WHERE OPERATOR_ID = ?',
            'UPDATE TM07_BENCH_EVENT SET OPERATOR_ID = NULL WHERE OPERATOR_ID = ?',
            'UPDATE TM07_SERIAL_ISSUED SET OPERATOR_ID = NULL WHERE OPERATOR_ID = ?',
            'UPDATE TM07_CYCLE_PROGRESS SET OPERATOR_ID = NULL WHERE OPERATOR_ID = ?',
        ] as $sql
    ) {
        try {
            $u = $pdo->prepare($sql);
            $u->execute([$operatorId]);
        } catch (Throwable) {
            // таблицы/колонки могут отсутствовать в старых БД
        }
    }

    $del = $pdo->prepare('DELETE FROM TM07_OPERATOR WHERE ID = ?');
    $del->execute([$operatorId]);

    $sessionOp = $_SESSION[BENCH_SESSION_OPERATOR] ?? null;
    if (is_array($sessionOp) && (int) ($sessionOp['ID'] ?? 0) === $operatorId) {
        unset($_SESSION[BENCH_SESSION_OPERATOR], $_SESSION[BENCH_SESSION_ORDER]);
    }

    return [
        'id' => $operatorId,
        'displayName' => (string) ($op['DISPLAY_NAME'] ?? $op['LOGIN'] ?? ('#' . $operatorId)),
    ];
}

/**
 * Админ: список рабочих мест (стендов).
 *
 * @return list<array<string,mixed>>
 */
function bench_admin_list_workstations(PDO $pdo): array
{
    if (!auth_is_admin()) {
        throw new RuntimeException('Требуется вход администратора');
    }
    $hasActive = false;
    try {
        $pdo->query('SELECT IS_ACTIVE FROM TM07_WORKSTATION WHERE 1=0');
        $hasActive = true;
    } catch (Throwable) {
        $hasActive = false;
    }
    $cols = 'ID, CODE, NAME, HOSTNAME, CLIENT_FINGERPRINT, CONFIG_JSON, UPDATED_AT';
    try {
        $pdo->query('SELECT CREATED_AT FROM TM07_WORKSTATION WHERE 1=0');
        $cols .= ', CREATED_AT';
    } catch (Throwable) {
        // нет CREATED_AT
    }
    if ($hasActive) {
        $cols .= ', IS_ACTIVE';
    }
    $rows = [];
    try {
        $st = $pdo->query("SELECT {$cols} FROM TM07_WORKSTATION ORDER BY UPDATED_AT DESC NULLS LAST, ID DESC");
        $rows = $st ? ($st->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];
    } catch (Throwable) {
        $st = $pdo->query("SELECT {$cols} FROM TM07_WORKSTATION ORDER BY ID DESC");
        $rows = $st ? ($st->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];
    }
    $out = [];
    foreach ($rows as $row) {
        $api = bench_workstation_row_to_api($row);
        $api['isActive'] = $hasActive ? (int) ($row['IS_ACTIVE'] ?? 1) === 1 : true;
        $api['createdAt'] = $row['CREATED_AT'] ?? null;
        $cfg = is_array($api['clientConfig']) ? $api['clientConfig'] : [];
        $api['deviceUsb'] = isset($cfg['deviceUsb']) && is_array($cfg['deviceUsb']) ? $cfg['deviceUsb'] : null;
        $out[] = $api;
    }

    return $out;
}

/**
 * Админ: обновить имя / активность / USB-профили стенда.
 *
 * @param array<string,mixed> $body
 * @return array<string,mixed>
 */
function bench_admin_update_workstation(PDO $pdo, array $body): array
{
    if (!auth_is_admin()) {
        throw new RuntimeException('Требуется вход администратора');
    }
    $id = (int) ($body['id'] ?? $body['workstationId'] ?? 0);
    if ($id <= 0) {
        throw new InvalidArgumentException('id рабочего места обязателен');
    }
    $st = $pdo->prepare(
        'SELECT ID, CODE, NAME, HOSTNAME, CLIENT_FINGERPRINT, CONFIG_JSON, UPDATED_AT FROM TM07_WORKSTATION WHERE ID = ?'
    );
    $st->execute([$id]);
    $row = $st->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        throw new InvalidArgumentException('Рабочее место не найдено');
    }

    $name = array_key_exists('name', $body) ? trim((string) $body['name']) : (string) ($row['NAME'] ?? '');
    if ($name === '') {
        $name = (string) ($row['CODE'] ?? ('WS' . $id));
    }

    $cfg = [];
    if (!empty($row['CONFIG_JSON'])) {
        $decoded = json_decode((string) $row['CONFIG_JSON'], true);
        if (is_array($decoded)) {
            $cfg = $decoded;
        }
    }
    if (array_key_exists('deviceUsb', $body)) {
        $usb = $body['deviceUsb'];
        if ($usb === null) {
            unset($cfg['deviceUsb']);
        } elseif (is_array($usb)) {
            $cfg['deviceUsb'] = bench_normalize_device_usb($usb);
        }
    }
    $configJson = $cfg === [] ? null : json_encode($cfg, JSON_UNESCAPED_UNICODE);

    $nowExpr = bench_sql_now($pdo);
    $sets = ['NAME = ?', 'CONFIG_JSON = ?', 'UPDATED_AT = ' . $nowExpr];
    $params = [$name, $configJson];

    $wantActive = null;
    if (array_key_exists('isActive', $body) || array_key_exists('is_active', $body)) {
        $raw = $body['isActive'] ?? $body['is_active'];
        $wantActive = filter_var($raw, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($wantActive === null) {
            $wantActive = (int) $raw === 1;
        }
        try {
            $pdo->query('SELECT IS_ACTIVE FROM TM07_WORKSTATION WHERE 1=0');
            $sets[] = 'IS_ACTIVE = ?';
            $params[] = $wantActive ? 1 : 0;
        } catch (Throwable) {
            // колонка отсутствует
        }
    }
    $params[] = $id;
    $sql = 'UPDATE TM07_WORKSTATION SET ' . implode(', ', $sets) . ' WHERE ID = ?';
    $upd = $pdo->prepare($sql);
    $upd->execute($params);

    $st2 = $pdo->prepare(
        'SELECT ID, CODE, NAME, HOSTNAME, CLIENT_FINGERPRINT, CONFIG_JSON, UPDATED_AT FROM TM07_WORKSTATION WHERE ID = ?'
    );
    $st2->execute([$id]);
    $fresh = $st2->fetch(PDO::FETCH_ASSOC) ?: $row;
    $api = bench_workstation_row_to_api($fresh);
    $api['isActive'] = $wantActive !== null ? $wantActive : true;
    $cfg2 = is_array($api['clientConfig']) ? $api['clientConfig'] : [];
    $api['deviceUsb'] = isset($cfg2['deviceUsb']) && is_array($cfg2['deviceUsb']) ? $cfg2['deviceUsb'] : null;

    return $api;
}

/**
 * @param array<string,mixed> $usb
 * @return array<string,mixed>
 */
function bench_normalize_device_usb(array $usb): array
{
    $out = [];
    foreach (['vendorIdHex', 'tm07ProductIdHex', 'mitProductIdHex', 'pkdProductIdHex', 'pkdVendorIdHex', 'kaoSerialNumber'] as $k) {
        if (!isset($usb[$k])) {
            continue;
        }
        $v = trim((string) $usb[$k]);
        if ($v !== '') {
            $out[$k] = $v;
        }
    }
    if (isset($usb['m90Channels']) && is_array($usb['m90Channels'])) {
        $chs = [];
        foreach ($usb['m90Channels'] as $ch) {
            if (!is_array($ch)) {
                continue;
            }
            $chs[] = [
                'id' => trim((string) ($ch['id'] ?? '')),
                'productIdHex' => trim((string) ($ch['productIdHex'] ?? '')),
                'label' => trim((string) ($ch['label'] ?? '')),
                'setpointC' => isset($ch['setpointC']) ? (float) $ch['setpointC'] : null,
            ];
        }
        $out['m90Channels'] = $chs;
    }

    return $out;
}

/**
 * Найти deviceUsb стенда по fingerprint / code (для merge настроек).
 *
 * @return array<string,mixed>|null
 */
function bench_workstation_device_usb(PDO $pdo, ?string $fingerprint = null, ?string $code = null): ?array
{
    $row = bench_find_workstation($pdo, $code, $fingerprint);
    if (!$row || empty($row['CONFIG_JSON'])) {
        return null;
    }
    $decoded = json_decode((string) $row['CONFIG_JSON'], true);
    if (!is_array($decoded) || !isset($decoded['deviceUsb']) || !is_array($decoded['deviceUsb'])) {
        return null;
    }

    return bench_normalize_device_usb($decoded['deviceUsb']);
}

/**
 * Наложить USB-профиль стенда на device_settings.
 *
 * @param array<string,mixed> $settings
 * @param array<string,mixed> $usb
 * @return array<string,mixed>
 */
function bench_apply_device_usb_to_settings(array $settings, array $usb): array
{
    if (isset($usb['vendorIdHex'])) {
        if (!isset($settings['usb']) || !is_array($settings['usb'])) {
            $settings['usb'] = [];
        }
        $settings['usb']['vendorIdHex'] = $usb['vendorIdHex'];
    }
    if (isset($usb['tm07ProductIdHex'])) {
        if (!isset($settings['tm07']) || !is_array($settings['tm07'])) {
            $settings['tm07'] = [];
        }
        $settings['tm07']['usbAdapterProductIdHex'] = $usb['tm07ProductIdHex'];
    }
    if (isset($usb['mitProductIdHex'])) {
        if (!isset($settings['mit']) || !is_array($settings['mit'])) {
            $settings['mit'] = [];
        }
        $settings['mit']['productIdHex'] = $usb['mitProductIdHex'];
    }
    if (isset($usb['pkdProductIdHex']) || isset($usb['pkdVendorIdHex'])) {
        if (!isset($settings['pkd160']) || !is_array($settings['pkd160'])) {
            $settings['pkd160'] = [];
        }
        if (isset($usb['pkdProductIdHex'])) {
            $settings['pkd160']['productIdHex'] = $usb['pkdProductIdHex'];
        }
        if (isset($usb['pkdVendorIdHex'])) {
            $settings['pkd160']['vendorIdHex'] = $usb['pkdVendorIdHex'];
        }
    }
    if (isset($usb['m90Channels']) && is_array($usb['m90Channels']) && $usb['m90Channels'] !== []) {
        if (!isset($settings['m90']) || !is_array($settings['m90'])) {
            $settings['m90'] = [];
        }
        $existing = isset($settings['m90']['channels']) && is_array($settings['m90']['channels'])
            ? $settings['m90']['channels']
            : [];
        $byId = [];
        foreach ($existing as $ch) {
            if (is_array($ch) && isset($ch['id'])) {
                $byId[(string) $ch['id']] = $ch;
            }
        }
        $mergedCh = [];
        foreach ($usb['m90Channels'] as $ch) {
            if (!is_array($ch)) {
                continue;
            }
            $id = (string) ($ch['id'] ?? '');
            $base = $id !== '' && isset($byId[$id]) ? $byId[$id] : [];
            $mergedCh[] = array_merge($base, array_filter([
                'id' => $id !== '' ? $id : ($base['id'] ?? ''),
                'productIdHex' => $ch['productIdHex'] ?? ($base['productIdHex'] ?? ''),
                'label' => $ch['label'] ?? ($base['label'] ?? ''),
                'setpointC' => $ch['setpointC'] ?? ($base['setpointC'] ?? null),
            ], static fn ($v) => $v !== null && $v !== ''));
        }
        if ($mergedCh !== []) {
            $settings['m90']['channels'] = $mergedCh;
        }
    }

    return $settings;
}


/** @return list<string> */
function bench_sensor_channels(): array
{
    return ['DA', 'DT', 'DD', 'TT'];
}

function bench_normalize_sensor_channel(string $channel): string
{
    $ch = strtoupper(trim($channel));
    $aliases = ['DP' => 'DD', 'TG' => 'DT', 'TP' => 'TT', 'PAD' => 'DA', 'PTG' => 'DT', 'PPD' => 'DD', 'PTTP' => 'TT'];
    if (isset($aliases[$ch])) {
        $ch = $aliases[$ch];
    }
    if (!in_array($ch, bench_sensor_channels(), true)) {
        throw new InvalidArgumentException('Канал датчика: DA|DT|DD|TT');
    }

    return $ch;
}

/**
 * @return array<string,mixed>|null
 */
function bench_sensor_row_to_api(?array $row): ?array
{
    if (!$row) {
        return null;
    }

    return [
        'id' => (int) ($row['ID'] ?? 0),
        'serialCorrector' => (string) ($row['SERIAL_CORRECTOR'] ?? ''),
        'channel' => (string) ($row['CHANNEL'] ?? ''),
        'sensorSerial' => (string) ($row['SENSOR_SERIAL'] ?? ''),
        'qrRaw' => $row['QR_RAW'] ?? null,
        'sessionId' => isset($row['SESSION_ID']) ? (int) $row['SESSION_ID'] : null,
        'orderNumber' => $row['ORDER_NUMBER'] ?? null,
        'createdAt' => $row['CREATED_AT'] ?? null,
        'updatedAt' => $row['UPDATED_AT'] ?? null,
    ];
}

/**
 * @return array<string,mixed>|null
 */
function bench_find_sensor_by_serial(PDO $pdo, string $sensorSerial): ?array
{
    $sn = trim($sensorSerial);
    if ($sn === '') {
        return null;
    }
    $st = $pdo->prepare(
        'SELECT ID, SERIAL_CORRECTOR, CHANNEL, SENSOR_SERIAL, QR_RAW, SESSION_ID, ORDER_NUMBER, CREATED_AT, UPDATED_AT
         FROM TM07_CORRECTOR_SENSOR WHERE SENSOR_SERIAL = ?'
    );
    $st->execute([$sn]);
    $row = $st->fetch(PDO::FETCH_ASSOC);

    return $row ?: null;
}

/**
 * @return list<array<string,mixed>>
 */
function bench_list_sensors_by_corrector(PDO $pdo, string $serialCorrector): array
{
    $sn = trim($serialCorrector);
    if ($sn === '') {
        return [];
    }
    $st = $pdo->prepare(
        'SELECT ID, SERIAL_CORRECTOR, CHANNEL, SENSOR_SERIAL, QR_RAW, SESSION_ID, ORDER_NUMBER, CREATED_AT, UPDATED_AT
         FROM TM07_CORRECTOR_SENSOR WHERE SERIAL_CORRECTOR = ? ORDER BY CHANNEL'
    );
    $st->execute([$sn]);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];
    $out = [];
    foreach ($rows as $row) {
        $api = bench_sensor_row_to_api($row);
        if ($api) {
            $out[] = $api;
        }
    }

    return $out;
}

/**
 * Привязать датчик к корректору.
 * Идемпотентно при той же паре; 409-логика через исключения.
 *
 * @param array<string,mixed> $body
 * @return array{binding:array<string,mixed>, created:bool, unchanged:bool}
 */
function bench_bind_corrector_sensor(PDO $pdo, array $body): array
{
    if (!bench_table_exists($pdo, 'TM07_CORRECTOR_SENSOR')) {
        bench_ensure_corrector_sensor_table($pdo);
    }
    $serialCorrector = trim((string) ($body['serialCorrector'] ?? $body['serial_corrector'] ?? ''));
    $channel = bench_normalize_sensor_channel((string) ($body['channel'] ?? ''));
    $sensorSerial = trim((string) ($body['sensorSerial'] ?? $body['sensor_serial'] ?? ''));
    $qrRaw = isset($body['qrRaw']) ? trim((string) $body['qrRaw']) : (isset($body['qr_raw']) ? trim((string) $body['qr_raw']) : null);
    if ($qrRaw === '') {
        $qrRaw = null;
    }
    if ($serialCorrector === '' || !preg_match('/^\d{10}$/', $serialCorrector)) {
        throw new InvalidArgumentException('serialCorrector: ожидается 10 цифр (300…)');
    }
    if ($sensorSerial === '') {
        throw new InvalidArgumentException('sensorSerial обязателен');
    }

    $existingSensor = bench_find_sensor_by_serial($pdo, $sensorSerial);
    if ($existingSensor) {
        $exCorr = (string) ($existingSensor['SERIAL_CORRECTOR'] ?? '');
        $exCh = (string) ($existingSensor['CHANNEL'] ?? '');
        if ($exCorr === $serialCorrector && $exCh === $channel) {
            return [
                'binding' => bench_sensor_row_to_api($existingSensor),
                'created' => false,
                'unchanged' => true,
            ];
        }
        throw new RuntimeException(
            'Датчик ' . $sensorSerial . ' уже привязан к корректору ' . $exCorr . ' (' . $exCh . ')'
        );
    }

    $stCh = $pdo->prepare(
        'SELECT ID, SERIAL_CORRECTOR, CHANNEL, SENSOR_SERIAL, QR_RAW, SESSION_ID, ORDER_NUMBER, CREATED_AT, UPDATED_AT
         FROM TM07_CORRECTOR_SENSOR WHERE SERIAL_CORRECTOR = ? AND CHANNEL = ?'
    );
    $stCh->execute([$serialCorrector, $channel]);
    $existingChannel = $stCh->fetch(PDO::FETCH_ASSOC);
    if ($existingChannel) {
        $exSn = (string) ($existingChannel['SENSOR_SERIAL'] ?? '');
        if ($exSn === $sensorSerial) {
            return [
                'binding' => bench_sensor_row_to_api($existingChannel),
                'created' => false,
                'unchanged' => true,
            ];
        }
        throw new RuntimeException(
            'У корректора ' . $serialCorrector . ' канал ' . $channel . ' уже занят датчиком ' . $exSn
        );
    }

    $ctx = bench_current_context($pdo, $body);
    $sessionId = isset($body['sessionId']) ? (int) $body['sessionId'] : (int) ($_SESSION[BENCH_SESSION_ORDER] ?? 0);
    if ($sessionId <= 0) {
        $sessionId = null;
    }
    $orderNumber = trim((string) ($body['orderNumber'] ?? ''));
    if ($orderNumber === '') {
        $orderNumber = null;
    }
    $nowExpr = bench_sql_now($pdo);

    if (bench_is_pgsql($pdo) || bench_is_firebird($pdo)) {
        $sql = 'INSERT INTO TM07_CORRECTOR_SENSOR
            (SERIAL_CORRECTOR, CHANNEL, SENSOR_SERIAL, QR_RAW, SESSION_ID, ORDER_NUMBER, OPERATOR_ID, WORKSTATION_ID, CREATED_AT, UPDATED_AT)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ' . $nowExpr . ', ' . $nowExpr . ')
            RETURNING ID, SERIAL_CORRECTOR, CHANNEL, SENSOR_SERIAL, QR_RAW, SESSION_ID, ORDER_NUMBER, CREATED_AT, UPDATED_AT';
        $st = $pdo->prepare($sql);
        $st->execute([
            $serialCorrector,
            $channel,
            $sensorSerial,
            $qrRaw,
            $sessionId,
            $orderNumber,
            $ctx['operatorId'],
            $ctx['workstationId'],
        ]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
    } else {
        $st = $pdo->prepare(
            'INSERT INTO TM07_CORRECTOR_SENSOR
            (SERIAL_CORRECTOR, CHANNEL, SENSOR_SERIAL, QR_RAW, SESSION_ID, ORDER_NUMBER, OPERATOR_ID, WORKSTATION_ID, CREATED_AT, UPDATED_AT)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ' . $nowExpr . ', ' . $nowExpr . ')'
        );
        $st->execute([
            $serialCorrector,
            $channel,
            $sensorSerial,
            $qrRaw,
            $sessionId,
            $orderNumber,
            $ctx['operatorId'],
            $ctx['workstationId'],
        ]);
        $id = (int) $pdo->lastInsertId();
        $st2 = $pdo->prepare(
            'SELECT ID, SERIAL_CORRECTOR, CHANNEL, SENSOR_SERIAL, QR_RAW, SESSION_ID, ORDER_NUMBER, CREATED_AT, UPDATED_AT
             FROM TM07_CORRECTOR_SENSOR WHERE ID = ?'
        );
        $st2->execute([$id]);
        $row = $st2->fetch(PDO::FETCH_ASSOC);
    }
    if (!$row) {
        throw new RuntimeException('Не удалось сохранить привязку датчика');
    }

    try {
        bench_log_event($pdo, [
            'eventType' => 'sensor_bind',
            'stage' => 'parametrization',
            'serialCorrector' => $serialCorrector,
            'sessionId' => $sessionId,
            'orderNumber' => $orderNumber,
            'payload' => [
                'channel' => $channel,
                'sensorSerial' => $sensorSerial,
                'qrRaw' => $qrRaw,
            ],
        ]);
    } catch (Throwable) {
        // журнал не блокирует привязку
    }

    return [
        'binding' => bench_sensor_row_to_api($row),
        'created' => true,
        'unchanged' => false,
    ];
}

/**
 * Пакетная привязка: { serialCorrector, sensors: { DA: "…", DT: "…" }, qrRaw?: { DA: "…" } }
 *
 * @param array<string,mixed> $body
 * @return array{ok:bool, bindings:list<array<string,mixed>>, errors:list<array<string,string>>}
 */
function bench_bind_corrector_sensors_batch(PDO $pdo, array $body): array
{
    $serialCorrector = trim((string) ($body['serialCorrector'] ?? ''));
    $sensors = $body['sensors'] ?? null;
    if (!is_array($sensors)) {
        throw new InvalidArgumentException('sensors: объект { DA, DT, DD?, TT? }');
    }
    $qrMap = isset($body['qrRaw']) && is_array($body['qrRaw']) ? $body['qrRaw'] : [];
    $bindings = [];
    $errors = [];
    foreach ($sensors as $ch => $sn) {
        $sn = trim((string) $sn);
        if ($sn === '') {
            continue;
        }
        try {
            $res = bench_bind_corrector_sensor($pdo, array_merge($body, [
                'serialCorrector' => $serialCorrector,
                'channel' => (string) $ch,
                'sensorSerial' => $sn,
                'qrRaw' => $qrMap[$ch] ?? $qrMap[strtoupper((string) $ch)] ?? null,
            ]));
            $bindings[] = $res['binding'];
        } catch (Throwable $e) {
            $errors[] = [
                'channel' => strtoupper((string) $ch),
                'sensorSerial' => $sn,
                'error' => $e->getMessage(),
            ];
        }
    }

    return [
        'ok' => $errors === [],
        'bindings' => $bindings,
        'errors' => $errors,
    ];
}

/**
 * @return list<array<string,mixed>>
 */
function bench_list_corrector_sensors(PDO $pdo, int $limit = 100, int $offset = 0, ?string $q = null): array
{
    $limit = max(1, min(500, $limit));
    $offset = max(0, $offset);
    $params = [];
    $where = '1=1';
    if ($q !== null && trim($q) !== '') {
        $where = '(SERIAL_CORRECTOR LIKE ? OR SENSOR_SERIAL LIKE ? OR CHANNEL = ?)';
        $like = '%' . trim($q) . '%';
        $params = [$like, $like, strtoupper(trim($q))];
    }
    $sql = 'SELECT ID, SERIAL_CORRECTOR, CHANNEL, SENSOR_SERIAL, QR_RAW, SESSION_ID, ORDER_NUMBER, CREATED_AT, UPDATED_AT
            FROM TM07_CORRECTOR_SENSOR WHERE ' . $where . ' ORDER BY ID DESC LIMIT ' . $limit . ' OFFSET ' . $offset;
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $out = [];
    foreach ($st->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
        $api = bench_sensor_row_to_api($row);
        if ($api) {
            $out[] = $api;
        }
    }

    return $out;
}

/**
 * Админ: отвязать датчик (по id или по паре корректор+канал / sensorSerial).
 *
 * @return array{deleted:bool, binding:?array}
 */
function bench_admin_unbind_sensor(PDO $pdo, array $body): array
{
    if (!auth_is_admin()) {
        throw new RuntimeException('Требуется вход администратора');
    }
    bench_ensure_corrector_sensor_table($pdo);
    $id = (int) ($body['id'] ?? $body['bindingId'] ?? 0);
    $row = null;
    if ($id > 0) {
        $st = $pdo->prepare(
            'SELECT ID, SERIAL_CORRECTOR, CHANNEL, SENSOR_SERIAL, QR_RAW, SESSION_ID, ORDER_NUMBER, CREATED_AT, UPDATED_AT
             FROM TM07_CORRECTOR_SENSOR WHERE ID = ?'
        );
        $st->execute([$id]);
        $row = $st->fetch(PDO::FETCH_ASSOC) ?: null;
    } else {
        $sensorSerial = trim((string) ($body['sensorSerial'] ?? $body['sensor_serial'] ?? ''));
        $serialCorrector = trim((string) ($body['serialCorrector'] ?? ''));
        $channel = strtoupper(trim((string) ($body['channel'] ?? '')));
        if ($sensorSerial !== '') {
            $row = bench_find_sensor_by_serial($pdo, $sensorSerial);
        } elseif ($serialCorrector !== '' && $channel !== '') {
            $st = $pdo->prepare(
                'SELECT ID, SERIAL_CORRECTOR, CHANNEL, SENSOR_SERIAL, QR_RAW, SESSION_ID, ORDER_NUMBER, CREATED_AT, UPDATED_AT
                 FROM TM07_CORRECTOR_SENSOR WHERE SERIAL_CORRECTOR = ? AND CHANNEL = ?'
            );
            $st->execute([$serialCorrector, $channel]);
            $row = $st->fetch(PDO::FETCH_ASSOC) ?: null;
        }
    }
    if (!$row) {
        throw new InvalidArgumentException('Привязка не найдена');
    }
    $del = $pdo->prepare('DELETE FROM TM07_CORRECTOR_SENSOR WHERE ID = ?');
    $del->execute([(int) $row['ID']]);

    return [
        'deleted' => true,
        'binding' => bench_sensor_row_to_api($row),
    ];
}

/**
 * @return list<array{prefix:string,monthKey:string,lastSeq:int}>
 */
function bench_admin_list_serial_counters(PDO $pdo): array
{
    if (!auth_is_admin()) {
        throw new RuntimeException('Требуется вход администратора');
    }
    $st = $pdo->query('SELECT PREFIX, MONTH_KEY, LAST_SEQ FROM TM07_SERIAL_COUNTER ORDER BY MONTH_KEY DESC, PREFIX');
    $out = [];
    foreach ($st ? $st->fetchAll(PDO::FETCH_ASSOC) : [] as $row) {
        $prefix = trim((string) ($row['PREFIX'] ?? $row['prefix'] ?? ''));
        $monthKey = trim((string) ($row['MONTH_KEY'] ?? $row['month_key'] ?? ''));
        $lastSeq = (int) ($row['LAST_SEQ'] ?? $row['last_seq'] ?? 0);
        $out[] = [
            'prefix' => $prefix,
            'monthKey' => $monthKey,
            'lastSeq' => $lastSeq,
            'nextSeq' => $lastSeq + 1,
        ];
    }
    return $out;
}

/**
 * @return array{prefix:string,monthKey:string,lastSeq:int}
 */
function bench_admin_set_serial_counter(PDO $pdo, string $prefix, string $monthKey, int $lastSeq): array
{
    if (!auth_is_admin()) {
        throw new RuntimeException('Требуется вход администратора');
    }
    $prefix = trim($prefix);
    $monthKey = trim($monthKey);
    if ($prefix === '' || $monthKey === '') {
        throw new InvalidArgumentException('prefix и monthKey обязательны');
    }
    if ($lastSeq < 0) {
        throw new InvalidArgumentException('lastSeq не может быть отрицательным');
    }
    $upd = $pdo->prepare('UPDATE TM07_SERIAL_COUNTER SET LAST_SEQ = ? WHERE PREFIX = ? AND MONTH_KEY = ?');
    $upd->execute([$lastSeq, $prefix, $monthKey]);
    if ($upd->rowCount() === 0) {
        $ins = $pdo->prepare('INSERT INTO TM07_SERIAL_COUNTER (PREFIX, MONTH_KEY, LAST_SEQ) VALUES (?, ?, ?)');
        $ins->execute([$prefix, $monthKey, $lastSeq]);
    }
    return [
        'prefix' => $prefix,
        'monthKey' => $monthKey,
        'lastSeq' => $lastSeq,
    ];
}

/**
 * Админ: отчёт параметров заказ vs корректор по S/N или номеру заказа.
 *
 * @return array{ok:bool,query:string,reports:list<array<string,mixed>>}
 */
function bench_admin_param_report(PDO $pdo, string $query): array
{
    if (!auth_is_admin()) {
        throw new RuntimeException('Требуется вход администратора');
    }
    $q = trim($query);
    if ($q === '') {
        throw new InvalidArgumentException('Укажите серийный номер или номер заказа');
    }

    $digits = serial_xlsx_order_digits($q);
    $canon = $digits !== '' ? bench_order_number_canonical($q) : '';
    $isSerial = (bool) preg_match('/^(300|400)\d{7}$/', $q);

    $typeId = bench_event_type_id($pdo, 'parametrization_verify');
    if ($typeId === null) {
        return ['ok' => true, 'query' => $q, 'reports' => []];
    }

    $where = ['E.EVENT_TYPE_ID = ?'];
    $params = [$typeId];
    $or = [];
    if ($isSerial) {
        $or[] = 'E.SERIAL_CORRECTOR = ?';
        $params[] = $q;
        $or[] = 'E.SERIAL_COMPLEX = ?';
        $params[] = $q;
    }
    if ($digits !== '') {
        $or[] = "E.PAYLOAD LIKE ?";
        $params[] = '%' . $digits . '%';
        if ($canon !== '') {
            $or[] = "E.PAYLOAD LIKE ?";
            $params[] = '%' . $canon . '%';
        }
    }
    if ($or === []) {
        $or[] = 'E.SERIAL_CORRECTOR LIKE ?';
        $params[] = '%' . $q . '%';
        $or[] = "E.PAYLOAD LIKE ?";
        $params[] = '%' . $q . '%';
    }
    $where[] = '(' . implode(' OR ', $or) . ')';

    if (bench_is_firebird($pdo)) {
        $sql =
            'SELECT FIRST 30 E.ID, E.EVENT_STATE, E.SERIAL_CORRECTOR, E.SERIAL_COMPLEX, E.PAYLOAD, E.CREATED_AT,
                    O.LOGIN AS OP_LOGIN, O.DISPLAY_NAME AS OP_NAME,
                    W.CODE AS WS_CODE, W.NAME AS WS_NAME
             FROM TM07_BENCH_EVENT E
             LEFT JOIN TM07_OPERATOR O ON O.ID = E.OPERATOR_ID
             LEFT JOIN TM07_WORKSTATION W ON W.ID = E.WORKSTATION_ID
             WHERE ' .
            implode(' AND ', $where) .
            ' ORDER BY E.ID DESC';
    } else {
        $sql =
            'SELECT E.ID, E.EVENT_STATE, E.SERIAL_CORRECTOR, E.SERIAL_COMPLEX, E.PAYLOAD, E.CREATED_AT,
                    O.LOGIN AS OP_LOGIN, O.DISPLAY_NAME AS OP_NAME,
                    W.CODE AS WS_CODE, W.NAME AS WS_NAME
             FROM TM07_BENCH_EVENT E
             LEFT JOIN TM07_OPERATOR O ON O.ID = E.OPERATOR_ID
             LEFT JOIN TM07_WORKSTATION W ON W.ID = E.WORKSTATION_ID
             WHERE ' .
            implode(' AND ', $where) .
            ' ORDER BY E.ID DESC
             LIMIT 30';
    }

    $st = $pdo->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll(PDO::FETCH_ASSOC) ?: [];

    $reports = [];
    foreach ($rows as $row) {
        $payload = bench_decode_event_payload(isset($row['PAYLOAD']) ? (string) $row['PAYLOAD'] : null);
        $orderNumber = trim((string) ($payload['orderNumber'] ?? ''));
        $sessionId = (int) ($payload['sessionId'] ?? 0);

        // Уточнение: если искали заказ — отсечь чужие payload с похожими цифрами.
        if ($digits !== '' && !$isSerial && $orderNumber !== '') {
            $payDigits = serial_xlsx_order_digits($orderNumber);
            if ($payDigits !== '' && $payDigits !== $digits) {
                continue;
            }
        }

        $paramsList = [];
        if (isset($payload['params']) && is_array($payload['params'])) {
            foreach ($payload['params'] as $p) {
                if (!is_array($p)) {
                    continue;
                }
                $paramsList[] = [
                    'stepId' => (string) ($p['stepId'] ?? ''),
                    'title' => (string) ($p['title'] ?? ''),
                    'order' => (string) ($p['order'] ?? ''),
                    'device' => (string) ($p['device'] ?? ''),
                    'ok' => array_key_exists('ok', $p) ? !empty($p['ok']) : true,
                    'compared' => array_key_exists('compared', $p) ? !empty($p['compared']) : true,
                ];
            }
        }

        $orderPayload = null;
        $session = null;
        if ($sessionId > 0) {
            try {
                $session = bench_fetch_session_by_id($pdo, $sessionId);
            } catch (Throwable) {
                $session = null;
            }
        }
        if (!$session && $orderNumber !== '') {
            try {
                if (bench_is_firebird($pdo)) {
                    $stS = $pdo->prepare(
                        'SELECT FIRST 1 ID, ORDER_NUMBER, ORDER_STATUS, ORDER_PAYLOAD, STATE, SESSION_STAGE, SERIAL_CORRECTOR, OPENED_AT, CLOSED_AT
                         FROM TM07_BENCH_SESSION WHERE ORDER_NUMBER = ? OR ORDER_NUMBER = ? ORDER BY ID DESC'
                    );
                } else {
                    $stS = $pdo->prepare(
                        'SELECT ID, ORDER_NUMBER, ORDER_STATUS, ORDER_PAYLOAD, STATE, SESSION_STAGE, SERIAL_CORRECTOR, OPENED_AT, CLOSED_AT
                         FROM TM07_BENCH_SESSION WHERE ORDER_NUMBER = ? OR ORDER_NUMBER = ? ORDER BY ID DESC LIMIT 1'
                    );
                }
                $stS->execute([$orderNumber, $canon !== '' ? $canon : $orderNumber]);
                $session = $stS->fetch(PDO::FETCH_ASSOC) ?: null;
            } catch (Throwable) {
                $session = null;
            }
        }
        if ($session && !empty($session['ORDER_PAYLOAD'])) {
            $decoded = json_decode((string) $session['ORDER_PAYLOAD'], true);
            if (is_array($decoded)) {
                $orderPayload = $decoded;
            }
        }

        $reports[] = [
            'eventId' => (int) ($row['ID'] ?? 0),
            'eventState' => (string) ($row['EVENT_STATE'] ?? ''),
            'createdAt' => (string) ($row['CREATED_AT'] ?? ''),
            'serialCorrector' => trim((string) ($row['SERIAL_CORRECTOR'] ?? '')),
            'serialComplex' => trim((string) ($row['SERIAL_COMPLEX'] ?? '')),
            'orderNumber' => $orderNumber,
            'sessionId' => $sessionId > 0 ? $sessionId : (int) ($session['ID'] ?? 0),
            'match' => (int) ($payload['match'] ?? 0),
            'mismatch' => (int) ($payload['mismatch'] ?? 0),
            'criticalMismatch' => (int) ($payload['criticalMismatch'] ?? 0),
            'hasParamSnapshot' => $paramsList !== [],
            'params' => $paramsList,
            'orderPayload' => $orderPayload,
            'operator' => [
                'login' => (string) ($row['OP_LOGIN'] ?? ''),
                'displayName' => (string) ($row['OP_NAME'] ?? ''),
            ],
            'workstation' => [
                'code' => (string) ($row['WS_CODE'] ?? ''),
                'name' => (string) ($row['WS_NAME'] ?? ''),
            ],
            'hint' => $paramsList === []
                ? 'Снимок параметров появится после следующей сверки (запись в корректор). Старые события хранят только счётчики.'
                : null,
        ];
    }

    return [
        'ok' => true,
        'query' => $q,
        'reports' => $reports,
    ];
}
