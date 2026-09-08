<?php
declare(strict_types=1);

require_once __DIR__ . '/bench_context.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    bench_json_response(['ok' => false, 'error' => 'Только POST'], 405);
}

$body = bench_read_json_body();
$action = (string) ($body['action'] ?? '');
$kind = (string) ($body['kind'] ?? '');

if (!in_array($kind, ['corrector', 'complex'], true)) {
    bench_json_response(['ok' => false, 'error' => 'kind: corrector | complex'], 400);
}

$date = isset($body['date']) && $body['date'] !== null && $body['date'] !== ''
    ? (string) $body['date']
    : null;

try {
    $pdo = bench_pdo();
    $driver = bench_db_driver();

    if ($action === 'peek') {
        bench_require_operator_session();
        $result = bench_peek_serial($pdo, $kind, $date, $body);
        bench_json_response(array_merge(['ok' => true, 'backend' => $driver], $result));
    }

    if ($action === 'allocate') {
        bench_require_operator_session();
        $result = bench_allocate_serial($pdo, $kind, $date, false, $body);
        bench_json_response(array_merge(['ok' => true, 'backend' => $driver], $result));
    }

    bench_json_response(['ok' => false, 'error' => 'action: allocate | peek'], 400);
} catch (RuntimeException $e) {
    bench_json_response(['ok' => false, 'error' => $e->getMessage()], 403);
} catch (InvalidArgumentException $e) {
    bench_json_response(['ok' => false, 'error' => $e->getMessage()], 400);
} catch (Throwable $e) {
    bench_json_response(['ok' => false, 'error' => $e->getMessage()], 500);
}
