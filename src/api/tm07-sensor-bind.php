<?php
declare(strict_types=1);

/**
 * Привязка датчиков (DA/DT/DD/TT) к S/N корректора.
 *
 * GET  ?action=byCorrector&serial=300…
 * GET  ?action=bySensor&serial=…
 * GET  ?action=list&q=&limit=&offset=
 * POST { action: bind, serialCorrector, channel, sensorSerial, qrRaw? }
 * POST { action: bindBatch, serialCorrector, sensors: {DA,DT,…}, qrRaw?: {} }
 */
require_once __DIR__ . '/bench_context.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    $pdo = bench_pdo();
    if (!bench_table_exists($pdo, 'TM07_CORRECTOR_SENSOR')) {
        bench_ensure_corrector_sensor_table($pdo);
    }

    if ($method === 'GET') {
        $action = (string) ($_GET['action'] ?? 'list');
        if (!auth_is_admin()) {
            try {
                bench_require_operator_session();
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => 'Нужен вход оператора или администратора'], 401);
            }
        }

        if ($action === 'byCorrector') {
            $serial = trim((string) ($_GET['serial'] ?? $_GET['serialCorrector'] ?? ''));
            if ($serial === '') {
                bench_json_response(['ok' => false, 'error' => 'serial обязателен'], 400);
            }
            $list = bench_list_sensors_by_corrector($pdo, $serial);
            bench_json_response(['ok' => true, 'serialCorrector' => $serial, 'sensors' => $list]);
        }

        if ($action === 'bySensor') {
            $serial = trim((string) ($_GET['serial'] ?? $_GET['sensorSerial'] ?? ''));
            if ($serial === '') {
                bench_json_response(['ok' => false, 'error' => 'serial обязателен'], 400);
            }
            $row = bench_find_sensor_by_serial($pdo, $serial);
            bench_json_response([
                'ok' => true,
                'found' => $row !== null,
                'binding' => bench_sensor_row_to_api($row),
            ]);
        }

        if ($action === 'list') {
            // list — для админки; оператору тоже можно читать свои привязки
            $q = isset($_GET['q']) ? trim((string) $_GET['q']) : null;
            $limit = (int) ($_GET['limit'] ?? 100);
            $offset = (int) ($_GET['offset'] ?? 0);
            $list = bench_list_corrector_sensors($pdo, $limit, $offset, $q);
            bench_json_response(['ok' => true, 'bindings' => $list, 'limit' => $limit, 'offset' => $offset]);
        }

        bench_json_response(['ok' => false, 'error' => 'action: byCorrector | bySensor | list'], 400);
    }

    if ($method === 'POST') {
        $body = bench_read_json_body();
        $action = (string) ($body['action'] ?? 'bind');

        if ($action === 'unbind') {
            auth_require_admin_role(AUTH_ROLE_MONITOR);
            try {
                $res = bench_admin_unbind_sensor($pdo, $body);
            } catch (InvalidArgumentException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 404);
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
            }
            bench_json_response(['ok' => true, 'deleted' => true, 'binding' => $res['binding']]);
        }

        bench_require_operator_session();

        if ($action === 'bind') {
            try {
                $res = bench_bind_corrector_sensor($pdo, $body);
            } catch (InvalidArgumentException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage(), 'conflict' => true], 409);
            }
            bench_json_response([
                'ok' => true,
                'created' => $res['created'],
                'unchanged' => $res['unchanged'],
                'binding' => $res['binding'],
            ]);
        }

        if ($action === 'bindBatch') {
            try {
                $res = bench_bind_corrector_sensors_batch($pdo, $body);
            } catch (InvalidArgumentException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
            }
            bench_json_response([
                'ok' => $res['ok'],
                'bindings' => $res['bindings'],
                'errors' => $res['errors'],
            ], $res['ok'] ? 200 : 409);
        }

        bench_json_response(['ok' => false, 'error' => 'action: bind | bindBatch | unbind'], 400);
    }

    bench_json_response(['ok' => false, 'error' => 'GET или POST'], 405);
} catch (Throwable $e) {
    $msg = $e->getMessage();
    $code = (stripos($msg, 'оператор') !== false || stripos($msg, 'админ') !== false) ? 403 : 500;
    bench_json_response(['ok' => false, 'error' => $msg], $code);
}
