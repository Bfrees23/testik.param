<?php
declare(strict_types=1);

require_once __DIR__ . '/bench_context.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    $pdo = bench_pdo();
    $driver = bench_db_driver();

    if ($method === 'GET') {
        $action = (string) ($_GET['action'] ?? 'status');

        if ($action === 'status') {
            $body = [
                'fingerprint' => (string) ($_GET['fingerprint'] ?? ''),
                'workstationCode' => (string) ($_GET['workstationCode'] ?? $_GET['code'] ?? $_GET['ws'] ?? ''),
                'clientConfig' => null,
            ];
            if (!empty($_GET['clientConfig']) && is_string($_GET['clientConfig'])) {
                $decoded = json_decode($_GET['clientConfig'], true);
                if (is_array($decoded)) {
                    $body['clientConfig'] = $decoded;
                }
            }
            $fp = trim($body['fingerprint']);
            $wsCode = bench_normalize_workstation_code((string) $body['workstationCode']);
            $row = bench_find_workstation(
                $pdo,
                $wsCode !== '' ? $wsCode : ($fp !== '' ? $fp : null),
                $fp !== '' ? $fp : null
            );
            if ($row) {
                $_SESSION[BENCH_SESSION_WORKSTATION] = (int) $row['ID'];
                $ws = bench_workstation_row_to_api($row);
            } else {
                $ws = null;
            }
            $op = bench_resolve_operator($pdo);
            // Сессия заказа только для текущего оператора; без входа — не подставляем чужой заказ.
            $session = ($row && $op)
                ? bench_get_active_order_session($pdo, (int) $row['ID'], (int) $op['ID'])
                : null;
            bench_json_response([
                'ok' => true,
                'driver' => $driver,
                'postgresConfigured' => function_exists('bench_pgsql_dsn') && bench_pgsql_dsn() !== null,
                'postgresReachable' => function_exists('bench_try_pgsql') && bench_try_pgsql(),
                'firebirdConfigured' => bench_firebird_dsn() !== null,
                'firebirdReachable' => bench_try_firebird(),
                'sqlitePath' => $driver === 'sqlite' ? bench_sqlite_path() : null,
                'operatorRequired' => true,
                'operatorPinRequired' => bench_operator_pin_required(),
                'orderSessionRequired' => true,
                'workstation' => $ws,
                'operator' => $op ? bench_operator_row_to_api($op) : null,
                'activeSession' => $session ? bench_session_row_to_api_enriched($pdo, $session) : null,
            ]);
        }

        if ($action === 'sessions') {
            auth_session_start();
            $ok = auth_is_admin();
            if (!$ok) {
                try {
                    bench_require_operator_session();
                    $ok = true;
                } catch (RuntimeException $e) {
                    bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
                }
            }
            $limit = min(100, max(1, (int) ($_GET['limit'] ?? 50)));
            $state = isset($_GET['state']) ? trim((string) $_GET['state']) : '';
            $sessions = bench_list_order_sessions($pdo, [
                'limit' => $limit,
                'state' => $state,
            ]);
            bench_json_response([
                'ok' => true,
                'sessions' => $sessions,
            ]);
        }

        bench_json_response(['ok' => false, 'error' => 'action: status | sessions'], 400);
    }

    if ($method === 'POST') {
        $body = bench_read_json_body();
        $action = (string) ($body['action'] ?? '');

        if ($action === 'registerWorkstation') {
            $ws = bench_register_client_workstation($pdo, $body);
            bench_json_response([
                'ok' => true,
                'workstation' => bench_workstation_row_to_api($ws),
            ]);
        }

        if ($action === 'selectOperator') {
            $rl = auth_rate_limit_check('operator_pin', 10, 300);
            if (!$rl['ok']) {
                bench_json_response([
                    'ok' => false,
                    'error' => 'Слишком много попыток PIN. Повторите через ' . (int) ($rl['retryAfter'] ?? 300) . ' с.',
                    'retryAfter' => (int) ($rl['retryAfter'] ?? 300),
                ], 429);
            }
            $login = trim((string) ($body['login'] ?? ''));
            if ($login === '') {
                bench_json_response(['ok' => false, 'error' => 'Укажите логин оператора'], 400);
            }
            $pin = isset($body['pin']) ? (string) $body['pin'] : '';
            $cols = bench_operator_select_cols();
            $sel = $pdo->prepare("SELECT {$cols} FROM TM07_OPERATOR WHERE LOGIN = ?");
            $sel->execute([$login]);
            $existing = $sel->fetch(PDO::FETCH_ASSOC) ?: null;
            if (!$existing) {
                bench_json_response(['ok' => false, 'error' => 'Оператор с таким логином не найден'], 404);
            }
            $lastName = trim((string) ($existing['LAST_NAME'] ?? ''));
            $firstName = isset($existing['FIRST_NAME']) ? trim((string) $existing['FIRST_NAME']) : '';
            $display = (string) ($existing['DISPLAY_NAME'] ?? '');
            $pinConfigured =
                bench_shared_operator_pin() !== ''
                || bench_parse_operator_pins_env() !== []
                || !empty($existing['PIN_HASH']);
            if (bench_operator_pin_enforced() && !$pinConfigured) {
                bench_json_response([
                    'ok' => false,
                    'error' => 'BENCH_REQUIRE_OPERATOR_PIN=1,, но не заданы BENCH_OPERATOR_PINS / BENCH_OPERATOR_PIN и нет PIN в БД',
                ], 503);
            }
            if (!bench_verify_operator_pin_for(
                $pin,
                $lastName,
                $firstName !== '' ? $firstName : null,
                $existing
            )) {
                auth_rate_limit_fail('operator_pin', 10, 300);
                bench_json_response(['ok' => false, 'error' => 'Неверный PIN оператора'], 403);
            }
            auth_rate_limit_clear('operator_pin');

            $ws = bench_register_client_workstation($pdo, $body);
            $op = bench_resolve_operator(
                $pdo,
                $login,
                $display,
                $lastName !== '' ? $lastName : null,
                $firstName !== '' ? $firstName : null,
                true
            );
            if (!$op) {
                bench_json_response(['ok' => false, 'error' => 'Не удалось сохранить оператора'], 500);
            }
            try {
                // Подтянуть PIN_HASH после create/update и сохранить персональный из .env.
                $fresh = bench_find_operator_by_names(
                    $pdo,
                    $lastName,
                    $firstName !== '' ? $firstName : null
                );
                if ($fresh) {
                    bench_persist_operator_pin_if_needed($pdo, $fresh, $pin);
                }
            } catch (Throwable) {
                // вход уже успешен
            }

            // Чужие active-сессии на этом ПК закрываем — заказ принадлежит оператору.
            try {
                bench_close_foreign_order_sessions($pdo, (int) $ws['ID'], (int) $op['ID'], 'operator_switch');
            } catch (Throwable) {
                // не блокируем вход
            }
            $activeSession = bench_get_active_order_session($pdo, (int) $ws['ID'], (int) $op['ID']);

            try {
                bench_log_event($pdo, [
                    'eventType' => 'operator_login',
                    'eventState' => 'done',
                    'stage' => 'auth',
                    'userLogin' => $login,
                    'userDisplayName' => $display,
                    'userLastName' => $lastName,
                    'userFirstName' => $firstName !== '' ? $firstName : null,
                    'workstationCode' => $ws['CODE'],
                    'payload' => [
                        'login' => $login,
                        'lastName' => $lastName,
                        'firstName' => $firstName !== '' ? $firstName : null,
                        'workstation' => bench_workstation_row_to_api($ws),
                    ],
                ]);
            } catch (Throwable) {
                // login succeeds even if event log fails
            }

            bench_json_response([
                'ok' => true,
                'operator' => bench_operator_row_to_api($op),
                'workstation' => bench_workstation_row_to_api($ws),
                'activeSession' => $activeSession ? bench_session_row_to_api_enriched($pdo, $activeSession) : null,
            ]);
        }

        if ($action === 'adminSelectOperator') {
            auth_require_admin_role(AUTH_ROLE_MONITOR);
            $login = trim((string) ($body['login'] ?? ''));
            if ($login === '') {
                bench_json_response(['ok' => false, 'error' => 'Укажите логин оператора'], 400);
            }
            $cols = bench_operator_select_cols();
            $sel = $pdo->prepare("SELECT {$cols} FROM TM07_OPERATOR WHERE LOGIN = ?");
            $sel->execute([$login]);
            $op = $sel->fetch(PDO::FETCH_ASSOC) ?: null;
            if (!$op) {
                bench_json_response(['ok' => false, 'error' => 'Оператор с таким логином не найден'], 404);
            }
            $ws = bench_register_client_workstation($pdo, $body);
            $op = bench_resolve_operator(
                $pdo,
                $login,
                (string) ($op['DISPLAY_NAME'] ?? ''),
                isset($op['LAST_NAME']) ? trim((string) $op['LAST_NAME']) : null,
                isset($op['FIRST_NAME']) ? trim((string) $op['FIRST_NAME']) : null,
                true
            );
            try {
                bench_close_foreign_order_sessions($pdo, (int) $ws['ID'], (int) $op['ID'], 'operator_switch');
            } catch (Throwable) {
                // не блокируем вход
            }
            $activeSession = bench_get_active_order_session($pdo, (int) $ws['ID'], (int) $op['ID']);
            bench_json_response([
                'ok' => true,
                'operator' => bench_operator_row_to_api($op),
                'workstation' => bench_workstation_row_to_api($ws),
                'activeSession' => $activeSession ? bench_session_row_to_api_enriched($pdo, $activeSession) : null,
            ]);
        }

        if ($action === 'clearOperator') {
            bench_close_order_session($pdo, 'operator_logout');
            unset($_SESSION[BENCH_SESSION_OPERATOR], $_SESSION[BENCH_SESSION_ORDER]);
            bench_json_response(['ok' => true]);
        }

        if ($action === 'listOperators') {
            auth_require_admin_role(AUTH_ROLE_MONITOR);
            $rows = bench_list_operators($pdo, (int) ($body['limit'] ?? 100));
            $list = [];
            foreach ($rows as $row) {
                $list[] = bench_operator_row_to_api($row);
            }
            bench_json_response(['ok' => true, 'operators' => $list]);
        }

        if ($action === 'setOperatorPin') {
            auth_require_admin_role(AUTH_ROLE_MONITOR);
            $pin = trim((string) ($body['pin'] ?? ''));
            if ($pin === '' || strlen($pin) < 3) {
                bench_json_response(['ok' => false, 'error' => 'PIN не короче 3 символов'], 400);
            }
            $operatorId = (int) ($body['operatorId'] ?? $body['id'] ?? 0);
            $op = null;
            if ($operatorId > 0) {
                $cols = bench_operator_select_cols();
                $st = $pdo->prepare("SELECT {$cols} FROM TM07_OPERATOR WHERE ID = ?");
                $st->execute([$operatorId]);
                $op = $st->fetch(PDO::FETCH_ASSOC) ?: null;
            } else {
                $ln = trim((string) ($body['lastName'] ?? ''));
                $fn = trim((string) ($body['firstName'] ?? ''));
                if ($ln === '') {
                    bench_json_response(['ok' => false, 'error' => 'operatorId или lastName обязателен'], 400);
                }
                $op = bench_find_operator_by_names($pdo, $ln, $fn !== '' ? $fn : null);
                if (!$op) {
                    // создать оператора и сразу задать PIN
                    $login = trim((string) ($body['login'] ?? ''));
                    if ($login === '') {
                        $login = bench_operator_auto_login($ln, $fn !== '' ? $fn : null);
                    }
                    $display = trim((string) ($body['displayName'] ?? ''));
                    if ($display === '') {
                        $display = bench_operator_display_name($ln, $fn !== '' ? $fn : null, $login);
                    }
                    $op = bench_resolve_operator(
                        $pdo,
                        $login,
                        $display,
                        $ln,
                        $fn !== '' ? $fn : null,
                        false
                    );
                }
            }
            if (!$op) {
                bench_json_response(['ok' => false, 'error' => 'Оператор не найден'], 404);
            }
            bench_set_operator_pin_hash($pdo, (int) $op['ID'], $pin);
            $cols = bench_operator_select_cols();
            $st = $pdo->prepare("SELECT {$cols} FROM TM07_OPERATOR WHERE ID = ?");
            $st->execute([(int) $op['ID']]);
            $fresh = $st->fetch(PDO::FETCH_ASSOC) ?: $op;
            bench_json_response([
                'ok' => true,
                'operator' => bench_operator_row_to_api($fresh),
            ]);
        }

        if ($action === 'selectOrder') {
            $orderNumber = trim((string) ($body['orderNumber'] ?? ''));
            $sessionId = (int) ($body['sessionId'] ?? $body['session_id'] ?? 0);
            if ($orderNumber === '' && $sessionId <= 0) {
                bench_json_response(['ok' => false, 'error' => 'orderNumber или sessionId обязателен'], 400);
            }
            $ws = bench_register_client_workstation($pdo, $body);
            try {
                $session = bench_open_order_session($pdo, $body);
            } catch (InvalidArgumentException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
            }
            $reused = !empty($session['__reused']);
            unset($session['__reused']);
            $op = bench_resolve_operator($pdo);
            bench_json_response([
                'ok' => true,
                'reused' => $reused,
                'reopened' => $reused,
                'session' => bench_session_row_to_api_enriched($pdo, $session),
                'operator' => $op ? bench_operator_row_to_api($op) : null,
                'workstation' => bench_workstation_row_to_api($ws),
            ]);
        }

        if ($action === 'clearOrder') {
            bench_require_operator_session();
            $closed = bench_close_order_session($pdo, (string) ($body['reason'] ?? 'manual'));
            bench_json_response(['ok' => true, 'closed' => $closed]);
        }

        if ($action === 'deleteSession') {
            auth_require_admin_role(AUTH_ROLE_MONITOR);
            $sessionId = (int) ($body['sessionId'] ?? 0);
            if ($sessionId <= 0) {
                bench_json_response(['ok' => false, 'error' => 'sessionId обязателен'], 400);
            }
            try {
                bench_delete_order_session($pdo, $sessionId, true);
            } catch (InvalidArgumentException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 404);
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
            }
            bench_json_response(['ok' => true, 'deleted' => true, 'sessionId' => $sessionId]);
        }

        if ($action === 'deleteAllSessions') {
            auth_require_admin_role(AUTH_ROLE_MONITOR);
            try {
                $deleted = bench_admin_delete_all_sessions($pdo);
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
            }
            bench_json_response(['ok' => true, 'deleted' => $deleted]);
        }

        if ($action === 'listSerials') {
            auth_require_admin_role(AUTH_ROLE_MONITOR);
            $limit = (int) ($body['limit'] ?? 50);
            $q = isset($body['q']) ? trim((string) $body['q']) : '';
            try {
                $list = bench_admin_list_serials($pdo, $limit, $q !== '' ? $q : null);
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
            }
            bench_json_response(['ok' => true, 'serials' => $list]);
        }

        if ($action === 'deleteSerial') {
            auth_require_admin_role(AUTH_ROLE_MONITOR);
            $serial = trim((string) ($body['serial'] ?? $body['serialNumber'] ?? ''));
            try {
                $info = bench_admin_delete_serial($pdo, $serial);
            } catch (InvalidArgumentException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 404);
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
            }
            bench_json_response(['ok' => true] + $info);
        }

        if ($action === 'deleteOperator') {
            auth_require_admin_role(AUTH_ROLE_MONITOR);
            $operatorId = (int) ($body['operatorId'] ?? $body['id'] ?? 0);
            try {
                $info = bench_admin_delete_operator($pdo, $operatorId);
            } catch (InvalidArgumentException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 404);
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
            }
            bench_json_response(['ok' => true, 'deleted' => true, 'operator' => $info]);
        }

        if ($action === 'closeStaleSessions') {
            auth_require_admin_role(AUTH_ROLE_MONITOR);
            $hours = (int) ($body['olderThanHours'] ?? 1);
            $closed = bench_close_stale_active_sessions($pdo, $hours);
            bench_json_response(['ok' => true, 'closed' => $closed, 'olderThanHours' => max(1, min(720, $hours))]);
        }

        if ($action === 'confirmAssembly') {
            bench_require_operator_session();
            try {
                $session = bench_confirm_assembly($pdo, $body);
            } catch (InvalidArgumentException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
            }
            bench_json_response([
                'ok' => true,
                'session' => $session,
            ]);
        }

        if ($action === 'listWorkstations') {
            auth_require_admin_role(AUTH_ROLE_CONFIG);
            try {
                $list = bench_admin_list_workstations($pdo);
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
            }
            bench_json_response(['ok' => true, 'workstations' => $list]);
        }

        if ($action === 'updateWorkstation') {
            auth_require_admin_role(AUTH_ROLE_CONFIG);
            try {
                $ws = bench_admin_update_workstation($pdo, $body);
            } catch (InvalidArgumentException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
            }
            bench_json_response(['ok' => true, 'workstation' => $ws]);
        }

        bench_json_response(['ok' => false, 'error' => 'action: registerWorkstation | selectOperator | adminSelectOperator | selectOrder | clearOrder | deleteSession | deleteAllSessions | listSerials | deleteSerial | deleteOperator | closeStaleSessions | clearOperator | confirmAssembly | listOperators | setOperatorPin | listWorkstations | updateWorkstation'], 400);
    }

    bench_json_response(['ok' => false, 'error' => 'GET или POST'], 405);
} catch (Throwable $e) {
    bench_json_response(['ok' => false, 'error' => $e->getMessage()], 500);
}
