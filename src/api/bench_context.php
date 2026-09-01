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
 * SQLite datetime('now') — UTC; Firebird CURRENT_TIMESTAMP — обычно локаль сервера (МСК).
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
            $naiveTz =
                function_exists('bench_db_driver') && bench_db_driver() === 'sqlite'
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
    $allowed = ['userAgent', 'platform', 'language', 'languages', 'screen', 'timezone', 'hardwareConcurrency', 'deviceMemory', 'pageUrl', 'collectedAt'];
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

    // Браузер: уникальный ID ПК = fingerprint (localStorage). Не смешивать с TM07_WORKSTATION_CODE из .env.
    if ($fingerprint !== '') {
        $code = $fingerprint;
    } else {
        $code = $code ?: bench_env('TM07_WORKSTATION_CODE') ?: gethostname() ?: 'local';
    }

    if ($clientConfig) {
        $name = bench_workstation_label_from_config($clientConfig);
    } else {
        $name = bench_env('TM07_WORKSTATION_NAME') ?: ('Рабочее место ' . $code);
    }

    $hostname = gethostname() ?: null;
    $configJson = $clientConfig ? json_encode($clientConfig, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;
    $nowExpr = bench_is_firebird($pdo) ? 'CURRENT_TIMESTAMP' : "datetime('now')";

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
            $newName = $clientConfig ? $name : ($row['NAME'] ?? $name);
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

    return bench_pdo_retry(static function () use ($pdo, $code, $name, $hostname, $fingerprint, $configJson, $selectSql): array {
        if (bench_is_firebird($pdo)) {
            try {
                $ins = $pdo->prepare(
                    'INSERT INTO TM07_WORKSTATION (CODE, NAME, HOSTNAME, CLIENT_FINGERPRINT, CONFIG_JSON, UPDATED_AT)
                     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                     RETURNING ID, CODE, NAME, HOSTNAME, CLIENT_FINGERPRINT, CONFIG_JSON, UPDATED_AT'
                );
                $ins->execute([$code, $name, $hostname, $fingerprint !== '' ? $fingerprint : null, $configJson]);
                $created = $ins->fetch(PDO::FETCH_ASSOC);
                if (!$created) {
                    throw new RuntimeException('Не удалось создать рабочую станцию');
                }

                return $created;
            } catch (PDOException $e) {
                if (!str_contains($e->getMessage(), '-803')) {
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
             VALUES (?, ?, ?, ?, ?, datetime(\'now\'))'
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
            ],
        ]);
    } catch (Throwable) {
        // журнал необязателен для регистрации
    }

    return $ws;
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
        if (bench_is_firebird($pdo)) {
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

    if (bench_is_firebird($pdo)) {
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

    if (bench_is_firebird($pdo)) {
        $st = $pdo->prepare(
            'UPDATE TM07_BENCH_SESSION SET SESSION_STAGE = ?, SERIAL_CORRECTOR = ?, ASSEMBLY_CONFIRMED_AT = CURRENT_TIMESTAMP
             WHERE ID = ?'
        );
    } else {
        $st = $pdo->prepare(
            "UPDATE TM07_BENCH_SESSION SET SESSION_STAGE = ?, SERIAL_CORRECTOR = ?, ASSEMBLY_CONFIRMED_AT = datetime('now')
             WHERE ID = ?"
        );
    }
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
    $sql = 'SELECT SERIAL, PREFIX, MONTH_KEY, SEQ, ORDER_NUMBER FROM TM07_SERIAL_ISSUED
            WHERE KIND = ? AND ORDER_NUMBER IN (' . $placeholders . ')
            ORDER BY ID DESC';
    if (bench_is_firebird($pdo)) {
        $sql = 'SELECT FIRST 1 SERIAL, PREFIX, MONTH_KEY, SEQ, ORDER_NUMBER FROM TM07_SERIAL_ISSUED
                WHERE KIND = ? AND ORDER_NUMBER IN (' . $placeholders . ')
                ORDER BY ID DESC';
    } else {
        $sql .= ' LIMIT 1';
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
    $sql = "SELECT SERIAL_CORRECTOR, ORDER_NUMBER FROM TM07_BENCH_SESSION
            WHERE SERIAL_CORRECTOR IS NOT NULL AND SERIAL_CORRECTOR <> ''
              AND ORDER_NUMBER IN ($placeholders)
            ORDER BY ID DESC";
    if (bench_is_firebird($pdo)) {
        $sql = "SELECT FIRST 1 SERIAL_CORRECTOR, ORDER_NUMBER FROM TM07_BENCH_SESSION
                WHERE SERIAL_CORRECTOR IS NOT NULL AND SERIAL_CORRECTOR <> ''
                  AND ORDER_NUMBER IN ($placeholders)
                ORDER BY ID DESC";
    } else {
        $sql .= ' LIMIT 1';
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

    if ($orderNumber !== '') {
        // Только Excel: в Firebird уже лежат «локальные» 3002608062 и т.п., их нельзя возвращать.
        $existing = null;
        try {
            $existing = serial_xlsx_lookup($orderNumber, $kind);
        } catch (Throwable) {
            $existing = null;
        }
        if ($existing) {
            if (!$dryRun) {
                bench_remember_existing_serial($pdo, $existing, $kind, $orderNumber, $contextBody);
            }
            return bench_serial_result($meta, $existing, $kind, $dryRun, true, (string) ($existing['source'] ?? 'xlsx'), $orderNumber);
        }
    }

    $xlsxMax = 0;
    try {
        $xlsxMax = serial_xlsx_max_seq($prefix, $monthKey);
    } catch (Throwable) {
        $xlsxMax = 0;
    }

    if ($dryRun) {
        $nextSeq = $xlsxMax + 1;
        if ($nextSeq > 999) {
            throw new RuntimeException('Serial sequence overflow for ' . $prefix . $monthKey);
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
        return bench_serial_result($meta, $parsed, $kind, true, false, 'xlsx-next', $orderNumber);
    }

    $issuedXlsx = serial_xlsx_issue_new($kind, $orderNumber, $monthKey, [
        'execution' => (string) ($contextBody['execution'] ?? ''),
        'productTitle' => (string) ($contextBody['productTitle'] ?? ''),
        'characteristics' => (string) ($contextBody['characteristics'] ?? ''),
        'customer' => (string) ($contextBody['customer'] ?? ''),
        'fwVersion' => (string) ($contextBody['fwVersion'] ?? ''),
        'serialCorrector' => (string) ($contextBody['serialCorrector'] ?? ''),
        'serialComplex' => (string) ($contextBody['serialComplex'] ?? ''),
    ]);
    $serial = $issuedXlsx['serial'];
    $nextSeq = (int) $issuedXlsx['seq'];
    $parsed = [
        'serial' => $serial,
        'yy' => (int) $issuedXlsx['yy'],
        'mm' => (int) $issuedXlsx['mm'],
        'seq' => $nextSeq,
        'monthKey' => (string) $issuedXlsx['monthKey'],
        'prefix' => $prefix,
    ];

    bench_transaction_begin($pdo);
    try {
        if (!bench_is_firebird($pdo)) {
            try {
                if ($pdo->inTransaction()) {
                    $pdo->commit();
                }
            } catch (Throwable) {
            }
            $pdo->exec('BEGIN IMMEDIATE');
        }

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
        $payload = isset($contextBody['payload']) ? json_encode($contextBody['payload'], JSON_UNESCAPED_UNICODE) : null;

        // Старые выдачи счётчика (8062 и т.п.) не в таблице — снимаем UNIQUE, пишем канонический S/N.
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
            'payload' => ['serial' => $serial, 'kind' => $kind, 'orderNumber' => $orderNumber, 'source' => 'xlsx-new'],
        ]);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    return bench_serial_result($meta, $parsed, $kind, $dryRun, false, 'xlsx-new', $orderNumber);
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
    $paramSql =
        "SELECT E.ID, T.CODE AS EVENT_CODE, E.EVENT_STATE, E.SERIAL_CORRECTOR, E.SERIAL_COMPLEX,
                E.CREATED_AT, E.WORKSTATION_ID, E.PAYLOAD
         FROM TM07_BENCH_EVENT E
         JOIN TM07_EVENT_TYPE T ON T.ID = E.EVENT_TYPE_ID
         WHERE T.CODE IN ('parametrization_start', 'parametrization_done')
         ORDER BY E.CREATED_AT DESC";
    if (bench_is_firebird($pdo)) {
        $paramSql =
            "SELECT FIRST {$limit} E.ID, T.CODE AS EVENT_CODE, E.EVENT_STATE, E.SERIAL_CORRECTOR, E.SERIAL_COMPLEX,
                    E.CREATED_AT, E.WORKSTATION_ID, E.PAYLOAD
             FROM TM07_BENCH_EVENT E
             JOIN TM07_EVENT_TYPE T ON T.ID = E.EVENT_TYPE_ID
             WHERE T.CODE IN ('parametrization_start', 'parametrization_done')
             ORDER BY E.CREATED_AT DESC";
    } else {
        $paramSql .= ' LIMIT ' . $limit;
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
    $nowExpr = bench_is_firebird($pdo) ? 'CURRENT_TIMESTAMP' : "datetime('now')";
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
    $nowExpr = bench_is_firebird($pdo) ? 'CURRENT_TIMESTAMP' : "datetime('now')";
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

    if (bench_is_firebird($pdo)) {
        $sel = $pdo->query(
            "SELECT ID, WORKSTATION_ID, ORDER_NUMBER FROM TM07_BENCH_SESSION
             WHERE STATE = 'active'
               AND OPENED_AT < DATEADD(-{$olderThanHours} HOUR TO CURRENT_TIMESTAMP)"
        );
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
    } else {
        $upd = $pdo->prepare(
            "UPDATE TM07_BENCH_SESSION SET STATE = 'closed', CLOSED_AT = datetime('now')
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
        return bench_reopen_order_session($pdo, $sessionId, $body);
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
            return bench_reopen_order_session($pdo, (int) $existing['ID'], $bodyReuse);
        }
    }

    $active = bench_get_active_order_session($pdo, $wsId, $opId);
    if ($active && bench_orders_equal((string) ($active['ORDER_NUMBER'] ?? ''), $orderNumber)) {
        $_SESSION[BENCH_SESSION_ORDER] = (int) $active['ID'];

        return $active;
    }

    bench_close_active_order_sessions($pdo, $wsId, 'switch_order');

    $orderStatus = trim((string) ($body['orderStatus'] ?? ''));
    if ($orderStatus === '') {
        $orderStatus = null;
    }
    $payloadJson = bench_normalize_order_payload($body['orderPayload'] ?? null);

    if (bench_is_firebird($pdo)) {
        $ins = $pdo->prepare(
            'INSERT INTO TM07_BENCH_SESSION (ORDER_NUMBER, ORDER_STATUS, OPERATOR_ID, WORKSTATION_ID, ORDER_PAYLOAD, STATE, SESSION_STAGE, OPENED_AT)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
             VALUES (?, ?, ?, ?, ?, 'active', 'assembly', datetime('now'))"
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
         ORDER BY S.OPENED_AT DESC';

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
        $sql .= ' LIMIT ' . $limit;
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
    $pdo->exec('DELETE FROM TM07_BENCH_SESSION');
    unset($_SESSION[BENCH_SESSION_ORDER]);

    return $count;
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
