<?php
declare(strict_types=1);

require_once __DIR__ . '/bench_context.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    bench_json_response(['ok' => false, 'error' => 'Только POST'], 405);
}

try {
    $ip = site_file_log_client_ip();
    if (!site_action_log_rate_allow($ip)) {
        bench_json_response(['ok' => false, 'error' => 'Слишком много запросов, повторите позже'], 429);
    }

    $body = bench_read_json_body();
    $category = trim((string) ($body['category'] ?? 'ui'));
    if (strlen($category) > 32) {
        $category = substr($category, 0, 32);
    }
    $action = trim((string) ($body['action'] ?? ''));
    if ($action === '') {
        bench_json_response(['ok' => false, 'error' => 'action обязателен'], 400);
    }
    if (strlen($action) > 200) {
        $action = substr($action, 0, 200);
    }
    $detail = $body['detail'] ?? null;
    if (!is_array($detail) && $detail !== null) {
        $detail = ['value' => substr((string) $detail, 0, 500)];
    }
    $ctx = [
        'page' => isset($body['page']) ? substr((string) $body['page'], 0, 256) : null,
        'detail' => $detail,
    ];
    if (!empty($body['orderNumber'])) {
        $ctx['orderNumber'] = substr((string) $body['orderNumber'], 0, 64);
    }
    site_file_log($category !== '' ? $category : 'ui', $action, array_filter($ctx, static fn ($v) => $v !== null && $v !== ''));
    bench_json_response(['ok' => true]);
} catch (Throwable $e) {
    bench_json_response(['ok' => false, 'error' => $e->getMessage()], 500);
}
