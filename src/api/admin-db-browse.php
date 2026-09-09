<?php
declare(strict_types=1);

/**
 * Read-only browse of TM07_* tables for admin UI.
 */
require_once __DIR__ . '/bench_context.php';

header('Content-Type: application/json; charset=utf-8');

/** @var list<string> */
const ADMIN_DB_TABLES = [
    'TM07_WORKSTATION',
    'TM07_OPERATOR',
    'TM07_EVENT_TYPE',
    'TM07_SERIAL_COUNTER',
    'TM07_SERIAL_ISSUED',
    'TM07_BENCH_SESSION',
    'TM07_BENCH_EVENT',
    'TM07_CYCLE_PROGRESS',
    'TM07_CORRECTOR_SENSOR',
];

/** Columns never returned to the browser. */
const ADMIN_DB_REDACT = [
    'PIN_HASH' => true,
];

function admin_db_table_allowed(string $table): bool
{
    $up = strtoupper(trim($table));

    return in_array($up, ADMIN_DB_TABLES, true);
}

/**
 * @return list<array{name:string,count:int}>
 */
function admin_db_overview(PDO $pdo): array
{
    $out = [];
    foreach (ADMIN_DB_TABLES as $table) {
        $count = 0;
        try {
            $count = (int) $pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();
        } catch (Throwable) {
            $count = -1;
        }
        $out[] = ['name' => $table, 'count' => $count];
    }

    return $out;
}

/**
 * @return array{columns:list<string>, rows:list<array<string,mixed>>, total:int, limit:int, offset:int}
 */
function admin_db_browse(PDO $pdo, string $table, int $limit, int $offset): array
{
    $table = strtoupper(trim($table));
    if (!admin_db_table_allowed($table)) {
        throw new InvalidArgumentException('Таблица не в белом списке');
    }
    $limit = max(1, min(200, $limit));
    $offset = max(0, $offset);

    $total = (int) $pdo->query('SELECT COUNT(*) FROM ' . $table)->fetchColumn();

    $orderCol = 'ID';
    try {
        $pdo->query('SELECT ID FROM ' . $table . ' WHERE 1=0');
    } catch (Throwable) {
        $orderCol = null;
    }

    if ($orderCol !== null) {
        $sql = 'SELECT * FROM ' . $table . ' ORDER BY ID DESC LIMIT ' . $limit . ' OFFSET ' . $offset;
    } else {
        $sql = 'SELECT * FROM ' . $table . ' LIMIT ' . $limit . ' OFFSET ' . $offset;
    }
    $st = $pdo->query($sql);
    $rawRows = $st ? ($st->fetchAll(PDO::FETCH_ASSOC) ?: []) : [];

    $columns = [];
    $rows = [];
    foreach ($rawRows as $row) {
        $clean = [];
        foreach ($row as $k => $v) {
            $ku = strtoupper((string) $k);
            if (isset(ADMIN_DB_REDACT[$ku])) {
                $clean[$ku] = $v !== null && $v !== '' ? '••••' : null;
            } else {
                if (is_string($v) && strlen($v) > 400) {
                    $v = substr($v, 0, 400) . '…';
                }
                $clean[$ku] = $v;
            }
            if (!in_array($ku, $columns, true)) {
                $columns[] = $ku;
            }
        }
        $rows[] = $clean;
    }

    if ($columns === [] && $rawRows === []) {
        // Infer columns from empty probe
        try {
            $probe = $pdo->query('SELECT * FROM ' . $table . ' LIMIT 0');
            if ($probe) {
                for ($i = 0; $i < $probe->columnCount(); $i++) {
                    $meta = $probe->getColumnMeta($i);
                    if (is_array($meta) && isset($meta['name'])) {
                        $columns[] = strtoupper((string) $meta['name']);
                    }
                }
            }
        } catch (Throwable) {
        }
    }

    return [
        'columns' => $columns,
        'rows' => $rows,
        'total' => $total,
        'limit' => $limit,
        'offset' => $offset,
    ];
}

$action = (string) ($_GET['action'] ?? 'overview');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    auth_require_admin_role(AUTH_ROLE_MONITOR);
    $pdo = bench_pdo();

    if ($method === 'GET' && $action === 'overview') {
        echo json_encode([
            'ok' => true,
            'driver' => bench_db_driver(),
            'tables' => admin_db_overview($pdo),
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($method === 'GET' && $action === 'browse') {
        $table = (string) ($_GET['table'] ?? '');
        $limit = (int) ($_GET['limit'] ?? 50);
        $offset = (int) ($_GET['offset'] ?? 0);
        $data = admin_db_browse($pdo, $table, $limit, $offset);
        echo json_encode([
            'ok' => true,
            'driver' => bench_db_driver(),
            'table' => strtoupper(trim($table)),
            'columns' => $data['columns'],
            'rows' => $data['rows'],
            'total' => $data['total'],
            'limit' => $data['limit'],
            'offset' => $data['offset'],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'action: overview | browse'], JSON_UNESCAPED_UNICODE);
} catch (InvalidArgumentException $e) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    $msg = $e->getMessage();
    $code = (stripos($msg, 'админ') !== false || stripos($msg, 'Unauthorized') !== false) ? 401 : 500;
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg], JSON_UNESCAPED_UNICODE);
}
