<?php
declare(strict_types=1);

/** Health probe for Docker (php-fpm + Firebird). */
require_once __DIR__ . '/bench_context.php';

try {
    bench_pdo();
    if (!bench_try_firebird()) {
        fwrite(STDERR, "firebird unreachable\n");
        exit(1);
    }
    fwrite(STDOUT, "ok\n");
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}
