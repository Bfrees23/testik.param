<?php
declare(strict_types=1);

require_once __DIR__ . '/bench_context.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    $pdo = bench_pdo();

    if ($method === 'GET') {
        try {
            bench_require_operator_or_admin();
        } catch (RuntimeException $e) {
            bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
        }

        $action = (string) ($_GET['action'] ?? 'list');
        $limit = min(200, max(1, (int) ($_GET['limit'] ?? 50)));

        if ($action === 'types') {
            $rows = $pdo->query('SELECT ID, CODE, NAME, STAGE FROM TM07_EVENT_TYPE ORDER BY ID')->fetchAll(PDO::FETCH_ASSOC);
            $types = array_map(static function (array $r): array {
                return [
                    'id' => (int) $r['ID'],
                    'code' => $r['CODE'],
                    'name' => $r['NAME'],
                    'stage' => $r['STAGE'],
                ];
            }, $rows);
            bench_json_response(['ok' => true, 'types' => $types]);
        }

        if ($action === 'list' || $action === 'last') {
            $serialCorrector = isset($_GET['serialCorrector']) ? trim((string) $_GET['serialCorrector']) : '';
            $serialComplex = isset($_GET['serialComplex']) ? trim((string) $_GET['serialComplex']) : '';
            $stage = isset($_GET['stage']) ? trim((string) $_GET['stage']) : '';

            $where = ['1=1'];
            $params = [];
            if ($serialCorrector !== '') {
                $where[] = 'E.SERIAL_CORRECTOR = ?';
                $params[] = $serialCorrector;
            }
            if ($serialComplex !== '') {
                $where[] = 'E.SERIAL_COMPLEX = ?';
                $params[] = $serialComplex;
            }
            if ($stage !== '') {
                $where[] = 'E.STAGE = ?';
                $params[] = $stage;
            }

            $select = 'E.ID, T.CODE AS EVENT_TYPE, T.NAME AS EVENT_NAME, E.EVENT_STATE, E.STAGE,
                           E.SERIAL_CORRECTOR, E.SERIAL_COMPLEX, E.CREATED_AT,
                           O.LOGIN AS OPERATOR_LOGIN, O.DISPLAY_NAME AS OPERATOR_NAME,
                           W.CODE AS WORKSTATION_CODE, W.NAME AS WORKSTATION_NAME, E.PAYLOAD';
            $fromWhere = 'FROM TM07_BENCH_EVENT E
                    JOIN TM07_EVENT_TYPE T ON T.ID = E.EVENT_TYPE_ID
                    LEFT JOIN TM07_OPERATOR O ON O.ID = E.OPERATOR_ID
                    LEFT JOIN TM07_WORKSTATION W ON W.ID = E.WORKSTATION_ID
                    WHERE ' . implode(' AND ', $where) . '
                    ORDER BY E.CREATED_AT DESC';
            if (bench_is_firebird($pdo)) {
                $sql = 'SELECT FIRST ' . $limit . ' ' . $select . ' ' . $fromWhere;
            } else {
                $sql = 'SELECT ' . $select . ' ' . $fromWhere . ' LIMIT ' . $limit;
            }

            $st = $pdo->prepare($sql);
            $st->execute($params);
            $events = bench_map_events($st->fetchAll(PDO::FETCH_ASSOC));
            bench_json_response(['ok' => true, 'events' => $events]);
        }

        if ($action === 'exists') {
            $types = isset($_GET['types']) ? array_filter(array_map('trim', explode(',', (string) $_GET['types']))) : [];
            $serialCorrector = isset($_GET['serialCorrector']) ? trim((string) $_GET['serialCorrector']) : '';
            $serialComplex = isset($_GET['serialComplex']) ? trim((string) $_GET['serialComplex']) : '';

            if ($types === []) {
                bench_json_response(['ok' => false, 'error' => 'types обязателен (коды через запятую)'], 400);
            }

            $found = [];
            foreach ($types as $code) {
                $where = ['T.CODE = ?'];
                $params = [$code];
                if ($serialCorrector !== '') {
                    $where[] = 'E.SERIAL_CORRECTOR = ?';
                    $params[] = $serialCorrector;
                }
                if ($serialComplex !== '') {
                    $where[] = 'E.SERIAL_COMPLEX = ?';
                    $params[] = $serialComplex;
                }
                $sql = 'SELECT COUNT(*) FROM TM07_BENCH_EVENT E
                        JOIN TM07_EVENT_TYPE T ON T.ID = E.EVENT_TYPE_ID
                        WHERE ' . implode(' AND ', $where);
                $st = $pdo->prepare($sql);
                $st->execute($params);
                $found[$code] = ((int) $st->fetchColumn()) > 0;
            }

            bench_json_response([
                'ok' => true,
                'exists' => $found,
                'allPresent' => !in_array(false, $found, true),
            ]);
        }

        bench_json_response(['ok' => false, 'error' => 'action: list | types | last | exists'], 400);
    }

    if ($method === 'POST') {
        $body = bench_read_json_body();
        $action = (string) ($body['action'] ?? 'log');

        if ($action === 'log') {
            $eventType = trim((string) ($body['eventType'] ?? ''));
            if ($eventType === '') {
                bench_json_response(['ok' => false, 'error' => 'eventType обязателен'], 400);
            }
            try {
                bench_require_operator_or_admin();
            } catch (RuntimeException $e) {
                bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
            }
            $id = bench_log_event($pdo, $body);
            bench_json_response(['ok' => true, 'eventId' => $id, 'backend' => bench_db_driver()]);
        }

        bench_json_response(['ok' => false, 'error' => 'action: log'], 400);
    }

    bench_json_response(['ok' => false, 'error' => 'GET или POST'], 405);
} catch (InvalidArgumentException $e) {
    bench_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
} catch (Throwable $e) {
    bench_json_response(['ok' => false, 'error' => $e->getMessage()], 500);
}

/** @param list<array<string,mixed>> $rows */
function bench_map_events(array $rows): array
{
    return array_map(static function (array $r): array {
        $payload = $r['PAYLOAD'] ?? null;
        if (is_string($payload) && $payload !== '') {
            $decoded = json_decode($payload, true);
            if (is_array($decoded)) {
                $payload = $decoded;
            }
        }
        return [
            'id' => (int) $r['ID'],
            'eventType' => $r['EVENT_TYPE'],
            'eventName' => $r['EVENT_NAME'],
            'eventState' => $r['EVENT_STATE'],
            'stage' => $r['STAGE'],
            'serialCorrector' => $r['SERIAL_CORRECTOR'],
            'serialComplex' => $r['SERIAL_COMPLEX'],
            'createdAt' => $r['CREATED_AT'],
            'operator' => $r['OPERATOR_LOGIN'] ? [
                'login' => $r['OPERATOR_LOGIN'],
                'displayName' => $r['OPERATOR_NAME'],
            ] : null,
            'workstation' => $r['WORKSTATION_CODE'] ? [
                'code' => $r['WORKSTATION_CODE'],
                'name' => $r['WORKSTATION_NAME'],
            ] : null,
            'payload' => $payload,
        ];
    }, $rows);
}
