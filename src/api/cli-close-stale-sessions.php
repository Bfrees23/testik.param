<?php
declare(strict_types=1);

/**
 * ������� ��������� active-������ ������� (cron / ����� ����������).
 * php cli-close-stale-sessions.php [hours=24]
 */
require_once __DIR__ . '/bench_context.php';

$hours = isset($argv[1]) ? max(1, (int) $argv[1]) : 24;

try {
    $pdo = bench_pdo();
    $closed = bench_close_stale_active_sessions($pdo, $hours);
    fwrite(STDOUT, json_encode(['ok' => true, 'closed' => $closed, 'hours' => $hours], JSON_UNESCAPED_UNICODE) . "\n");
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE) . "\n");
    exit(1);
}
