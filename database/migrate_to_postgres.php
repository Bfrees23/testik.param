#!/usr/bin/env php
<?php
declare(strict_types=1);

/**
 * One-shot: copy TM07_* from current Firebird/SQLite source into PostgreSQL.
 *
 * Usage (from repo or inside php container):
 *   TM07_DB_DRIVER=firebird php database/migrate_to_postgres.php
 *   # or from SQLite:
 *   TM07_DB_DRIVER=sqlite php database/migrate_to_postgres.php
 *
 * Target always uses POSTGRES_* env. Does not drop existing PG rows unless --wipe.
 */

// Host layout: <repo>/database/migrate… → <repo>/src/api/
// Docker: /app/database + /app/api (src mounted at /app)
$root = dirname(__DIR__);
$benchCandidates = [
    $root . '/src/api/db_bench.php',
    $root . '/api/db_bench.php',
    __DIR__ . '/../api/db_bench.php',
];
$benchFile = null;
foreach ($benchCandidates as $c) {
    if (is_readable($c)) {
        $benchFile = $c;
        break;
    }
}
if ($benchFile === null) {
    fwrite(STDERR, "db_bench.php not found\n");
    exit(1);
}
require_once $benchFile;

$wipe = in_array('--wipe', $argv, true);

function migrate_connect_source(): PDO
{
    $forced = strtolower(trim((string) (getenv('TM07_MIGRATE_SOURCE') ?: getenv('TM07_DB_DRIVER') ?: '')));
    if ($forced === '' || $forced === 'pgsql' || $forced === 'postgres') {
        // Prefer firebird then sqlite for source
        if (bench_firebird_dsn() !== null && bench_try_firebird()) {
            $forced = 'firebird';
        } else {
            $forced = 'sqlite';
        }
    }
    putenv('TM07_DB_DRIVER=' . $forced);
    $_ENV['TM07_DB_DRIVER'] = $forced;
    // Reset static driver cache by using fresh connection path
    if ($forced === 'firebird') {
        $dsn = bench_firebird_dsn();
        if ($dsn === null) {
            throw new RuntimeException('Source Firebird not configured');
        }
        return new PDO($dsn, bench_env('FIREBIRD_USER', 'SYSDBA'), bench_env('FIREBIRD_PASSWORD', 'masterkey'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_CASE => PDO::CASE_UPPER,
        ]);
    }
    $path = bench_sqlite_path();
    if (!is_readable($path)) {
        throw new RuntimeException('Source SQLite not found: ' . $path);
    }
    $pdo = new PDO('sqlite:' . $path, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_CASE => PDO::CASE_UPPER,
    ]);
    $pdo->exec('PRAGMA foreign_keys = ON');
    return $pdo;
}

function migrate_connect_pg(): PDO
{
    $dsn = bench_pgsql_dsn();
    if ($dsn === null) {
        throw new RuntimeException('POSTGRES_HOST / POSTGRES_DB required for target');
    }
    $pdo = new PDO(
        $dsn,
        bench_env('POSTGRES_USER', 'tm07'),
        bench_env('POSTGRES_PASSWORD', 'tm07'),
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_CASE => PDO::CASE_UPPER,
        ]
    );
    $pdo->exec("SET TIME ZONE 'UTC'");
    bench_pgsql_ensure_schema($pdo);
    bench_run_migrations($pdo);
    return $pdo;
}

function migrate_fetch_all(PDO $pdo, string $table): array
{
    try {
        return $pdo->query('SELECT * FROM ' . $table)->fetchAll(PDO::FETCH_ASSOC) ?: [];
    } catch (Throwable $e) {
        fwrite(STDERR, "skip {$table}: " . $e->getMessage() . "\n");
        return [];
    }
}

function migrate_setval(PDO $pdo, string $table, string $idCol = 'id'): void
{
    $tableLow = strtolower($table);
    $idLow = strtolower($idCol);
    $sql = "SELECT setval(pg_get_serial_sequence('{$tableLow}', '{$idLow}'), COALESCE((SELECT MAX({$idLow}) FROM {$tableLow}), 1), true)";
    try {
        $pdo->exec($sql);
    } catch (Throwable $e) {
        fwrite(STDERR, "setval {$table}: " . $e->getMessage() . "\n");
    }
}

$src = migrate_connect_source();
$dst = migrate_connect_pg();

fwrite(STDOUT, 'Source driver: ' . $src->getAttribute(PDO::ATTR_DRIVER_NAME) . "\n");
fwrite(STDOUT, 'Target: PostgreSQL ' . (bench_env('POSTGRES_HOST') ?: '') . '/' . (bench_env('POSTGRES_DB') ?: '') . "\n");

if ($wipe) {
    fwrite(STDOUT, "Wiping target TM07_* tables…\n");
    $dst->exec('TRUNCATE tm07_bench_event, tm07_serial_issued, tm07_bench_session, tm07_cycle_progress, tm07_serial_counter, tm07_operator, tm07_workstation, tm07_event_type RESTART IDENTITY CASCADE');
}

$order = [
    'TM07_EVENT_TYPE' => ['CODE', 'NAME', 'STAGE', 'ID'],
    'TM07_WORKSTATION' => null,
    'TM07_OPERATOR' => null,
    'TM07_SERIAL_COUNTER' => null,
    'TM07_SERIAL_ISSUED' => null,
    'TM07_BENCH_SESSION' => null,
    'TM07_BENCH_EVENT' => null,
    'TM07_CYCLE_PROGRESS' => null,
];

$counts = [];

foreach ($order as $table => $preferCols) {
    $rows = migrate_fetch_all($src, $table);
    $counts[$table] = ['src' => count($rows), 'ins' => 0];
    if (!$rows) {
        continue;
    }
    foreach ($rows as $row) {
        $cols = array_keys($row);
        $placeholders = implode(', ', array_fill(0, count($cols), '?'));
        $colList = implode(', ', $cols);
        $updates = [];
        foreach ($cols as $c) {
            if (strtoupper($c) === 'ID') {
                continue;
            }
            $updates[] = $c . ' = EXCLUDED.' . $c;
        }
        $conflict = 'ID';
        if ($table === 'TM07_EVENT_TYPE') {
            $conflict = 'CODE';
        } elseif ($table === 'TM07_SERIAL_COUNTER') {
            $conflict = 'PREFIX, MONTH_KEY';
        } elseif ($table === 'TM07_CYCLE_PROGRESS') {
            $conflict = 'SERIAL_NUMBER';
        } elseif ($table === 'TM07_SERIAL_ISSUED') {
            $conflict = 'SERIAL';
        } elseif ($table === 'TM07_WORKSTATION') {
            $conflict = 'CODE';
        } elseif ($table === 'TM07_OPERATOR') {
            $conflict = 'LOGIN';
        }
        // Identity BY DEFAULT accepts explicit IDs; OVERRIDING helps ALWAYS columns.
        $sql = "INSERT INTO {$table} ({$colList}) OVERRIDING SYSTEM VALUE VALUES ({$placeholders})";
        if ($conflict !== 'ID' || isset($row['ID']) || isset($row['id'])) {
            $sql .= ' ON CONFLICT (' . $conflict . ') DO UPDATE SET ' . ($updates ? implode(', ', $updates) : $cols[0] . ' = EXCLUDED.' . $cols[0]);
        }
        try {
            $st = $dst->prepare($sql);
            $st->execute(array_values($row));
            $counts[$table]['ins']++;
        } catch (Throwable $e) {
            // Retry without ON CONFLICT for tables with only identity
            try {
                $sql2 = "INSERT INTO {$table} ({$colList}) VALUES ({$placeholders}) ON CONFLICT DO NOTHING";
                $st2 = $dst->prepare($sql2);
                $st2->execute(array_values($row));
                $counts[$table]['ins']++;
            } catch (Throwable $e2) {
                fwrite(STDERR, "{$table} row failed: " . $e2->getMessage() . "\n");
            }
        }
    }
    if ($table !== 'TM07_SERIAL_COUNTER' && $table !== 'TM07_CYCLE_PROGRESS') {
        migrate_setval($dst, $table);
    }
}

fwrite(STDOUT, "\nMigration summary:\n");
foreach ($counts as $table => $c) {
    fwrite(STDOUT, sprintf("  %-22s src=%-5d written≈%-5d\n", $table, $c['src'], $c['ins']));
}

$chk = [
    'tm07_operator' => (int) $dst->query('SELECT COUNT(*) FROM tm07_operator')->fetchColumn(),
    'tm07_bench_session' => (int) $dst->query('SELECT COUNT(*) FROM tm07_bench_session')->fetchColumn(),
    'tm07_bench_event' => (int) $dst->query('SELECT COUNT(*) FROM tm07_bench_event')->fetchColumn(),
    'tm07_serial_issued' => (int) $dst->query('SELECT COUNT(*) FROM tm07_serial_issued')->fetchColumn(),
];
fwrite(STDOUT, "\nPostgreSQL counts: " . json_encode($chk) . "\n");
fwrite(STDOUT, "Done. Set TM07_DB_DRIVER=pgsql and restart php.\n");
