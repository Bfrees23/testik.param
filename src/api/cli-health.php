#!/usr/bin/env php
<?php
declare(strict_types=1);

/** Health probe for Docker (php-fpm + PostgreSQL). */
require_once __DIR__ . '/bench_context.php';

try {
    $pdo = bench_pdo();
    $driver = bench_db_driver();
    if ($driver === 'pgsql') {
        $pdo->query('SELECT 1')->fetchColumn();
        $pdo->query('SELECT COUNT(*) FROM TM07_EVENT_TYPE')->fetchColumn();
    } elseif ($driver === 'firebird') {
        if (!bench_try_firebird()) {
            fwrite(STDERR, "firebird unreachable\n");
            exit(1);
        }
    }
    fwrite(STDOUT, "ok driver={$driver}\n");
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
