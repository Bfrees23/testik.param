<?php
/**
 * Операционные действия админки: логи, очередь notify, счётчики S/N, health, экспорт настроек.
 */
declare(strict_types=1);

require_once __DIR__ . '/auth_common.php';
require_once __DIR__ . '/bench_context.php';
require_once __DIR__ . '/lib/site_file_log.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function admin_ops_json(array $payload, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = '';
$body = [];

try {
    auth_session_start();
    auth_require_admin();

    if ($method === 'GET') {
        $action = trim((string) ($_GET['action'] ?? ''));
    } elseif ($method === 'POST') {
        $raw = file_get_contents('php://input');
        $decoded = is_string($raw) ? json_decode($raw, true) : null;
        $body = is_array($decoded) ? $decoded : [];
        $action = trim((string) ($body['action'] ?? $_GET['action'] ?? ''));
    } else {
        admin_ops_json(['ok' => false, 'error' => 'GET или POST'], 405);
    }

    if ($action === 'health') {
        $pdo = bench_pdo();
        $sessions = 0;
        $active = 0;
        $serials = 0;
        try {
            $sessions = (int) $pdo->query('SELECT COUNT(*) FROM TM07_BENCH_SESSION')->fetchColumn();
            $active = (int) $pdo->query("SELECT COUNT(*) FROM TM07_BENCH_SESSION WHERE STATE = 'active'")->fetchColumn();
            $serials = (int) $pdo->query('SELECT COUNT(*) FROM TM07_SERIAL_ISSUED')->fetchColumn();
        } catch (Throwable) {
        }
        $queuePath = rtrim(auth_data_dir(), '/\\') . '/operator_notify_queue.json';
        $queueItems = 0;
        if (is_readable($queuePath)) {
            $qj = json_decode((string) file_get_contents($queuePath), true);
            $queueItems = is_array($qj) && isset($qj['items']) && is_array($qj['items']) ? count($qj['items']) : 0;
        }
        admin_ops_json([
            'ok' => true,
            'dbDriver' => bench_db_driver(),
            'sessionsTotal' => $sessions,
            'sessionsActive' => $active,
            'serialsIssued' => $serials,
            'notifyQueueItems' => $queueItems,
            'settingsExists' => is_readable(auth_data_dir() . '/device_settings.json'),
        ]);
    }

    if ($action === 'actionLogDates') {
        auth_require_admin_role(AUTH_ROLE_MONITOR);
        $dir = site_file_logs_dir();
        $dates = [];
        foreach (glob($dir . '/site-actions-*.txt') ?: [] as $path) {
            if (preg_match('/site-actions-(\d{4}-\d{2}-\d{2})\.txt$/', $path, $m)) {
                $dates[] = $m[1];
            }
        }
        rsort($dates);
        admin_ops_json(['ok' => true, 'dates' => array_values($dates)]);
    }

    if ($action === 'actionLogs') {
        auth_require_admin_role(AUTH_ROLE_MONITOR);
        $date = trim((string) ($_GET['date'] ?? $body['date'] ?? date('Y-m-d')));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            admin_ops_json(['ok' => false, 'error' => 'Некорректная дата'], 400);
        }
        $tail = (int) ($_GET['tail'] ?? $body['tail'] ?? 200);
        $tail = max(20, min(2000, $tail));
        $path = site_file_log_path_for_date($date);
        if (!is_readable($path)) {
            admin_ops_json(['ok' => true, 'date' => $date, 'lines' => [], 'path' => basename($path)]);
        }
        $raw = file($path, FILE_IGNORE_NEW_LINES);
        if (!is_array($raw)) {
            $raw = [];
        }
        $lines = array_slice($raw, -$tail);
        admin_ops_json([
            'ok' => true,
            'date' => $date,
            'lines' => array_values($lines),
            'total' => count($raw),
            'shown' => count($lines),
        ]);
    }

    if ($action === 'notifyQueue') {
        auth_require_admin_role(AUTH_ROLE_MONITOR);
        $path = rtrim(auth_data_dir(), '/\\') . '/operator_notify_queue.json';
        if (!is_readable($path)) {
            admin_ops_json(['ok' => true, 'seq' => 0, 'items' => []]);
        }
        $j = json_decode((string) file_get_contents($path), true);
        if (!is_array($j)) {
            admin_ops_json(['ok' => true, 'seq' => 0, 'items' => []]);
        }
        admin_ops_json([
            'ok' => true,
            'seq' => (int) ($j['seq'] ?? 0),
            'items' => array_values(is_array($j['items'] ?? null) ? $j['items'] : []),
        ]);
    }

    if ($action === 'clearNotifyQueue' && $method === 'POST') {
        auth_require_admin_role(AUTH_ROLE_MONITOR);
        $path = rtrim(auth_data_dir(), '/\\') . '/operator_notify_queue.json';
        $payload = json_encode(['seq' => 0, 'items' => []], JSON_UNESCAPED_UNICODE);
        file_put_contents($path, $payload === false ? '{"seq":0,"items":[]}' : $payload, LOCK_EX);
        admin_ops_json(['ok' => true, 'cleared' => true]);
    }

    if ($action === 'serialCounters') {
        auth_require_admin_role(AUTH_ROLE_MONITOR);
        $pdo = bench_pdo();
        admin_ops_json(['ok' => true, 'counters' => bench_admin_list_serial_counters($pdo)]);
    }

    if ($action === 'setSerialCounter' && $method === 'POST') {
        auth_require_admin_role(AUTH_ROLE_MONITOR);
        $pdo = bench_pdo();
        $info = bench_admin_set_serial_counter(
            $pdo,
            (string) ($body['prefix'] ?? ''),
            (string) ($body['monthKey'] ?? $body['month_key'] ?? ''),
            (int) ($body['lastSeq'] ?? $body['last_seq'] ?? -1)
        );
        admin_ops_json(['ok' => true, 'counter' => $info]);
    }

    if ($action === 'exportSettings') {
        auth_require_admin_role(AUTH_ROLE_CONFIG);
        $path = auth_data_dir() . '/device_settings.json';
        if (!is_readable($path)) {
            admin_ops_json(['ok' => false, 'error' => 'device_settings.json не найден'], 404);
        }
        $raw = file_get_contents($path);
        $j = is_string($raw) ? json_decode($raw, true) : null;
        admin_ops_json([
            'ok' => true,
            'exportedAt' => gmdate('c'),
            'settings' => is_array($j) ? $j : new stdClass(),
        ]);
    }

    if ($action === 'importSettings' && $method === 'POST') {
        auth_require_admin_role(AUTH_ROLE_CONFIG);
        $settings = $body['settings'] ?? null;
        if (!is_array($settings)) {
            admin_ops_json(['ok' => false, 'error' => 'settings (object) обязателен'], 400);
        }
        $path = auth_data_dir() . '/device_settings.json';
        $json = json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        if ($json === false) {
            admin_ops_json(['ok' => false, 'error' => 'Не удалось сериализовать settings'], 400);
        }
        $tmp = $path . '.tmp';
        if (file_put_contents($tmp, $json . "\n", LOCK_EX) === false) {
            admin_ops_json(['ok' => false, 'error' => 'Не удалось записать'], 500);
        }
        if (!@rename($tmp, $path)) {
            @unlink($path);
            if (!@rename($tmp, $path)) {
                admin_ops_json(['ok' => false, 'error' => 'Не удалось сохранить'], 500);
            }
        }
        admin_ops_json(['ok' => true, 'saved' => true]);
    }

    if ($action === 'paramReport') {
        auth_require_admin_role(AUTH_ROLE_MONITOR);
        $q = trim((string) ($_GET['q'] ?? $body['q'] ?? ''));
        $pdo = bench_pdo();
        admin_ops_json(bench_admin_param_report($pdo, $q));
    }

    admin_ops_json([
        'ok' => false,
        'error' => 'action: health | actionLogDates | actionLogs | notifyQueue | clearNotifyQueue | serialCounters | setSerialCounter | exportSettings | importSettings | paramReport',
    ], 400);
} catch (InvalidArgumentException $e) {
    admin_ops_json(['ok' => false, 'error' => $e->getMessage()], 400);
} catch (RuntimeException $e) {
    $code = str_contains(mb_strtolower($e->getMessage()), 'админ') ? 401 : 400;
    admin_ops_json(['ok' => false, 'error' => $e->getMessage()], $code);
} catch (Throwable $e) {
    admin_ops_json(['ok' => false, 'error' => 'Server error'], 500);
}
