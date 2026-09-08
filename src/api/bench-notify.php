<?php
/**
 * Очередь уведомлений операторам (тест из админки / будущие push-события).
 *
 * action=push  (POST, admin) — положить уведомление о заказе
 * action=poll  (GET, operator|admin) — забрать новые с id > since
 */
declare(strict_types=1);

require_once __DIR__ . '/auth_common.php';
require_once __DIR__ . '/bench_context.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function bench_notify_queue_path(): string
{
    $dir = auth_data_dir();
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    return rtrim($dir, '/\\') . '/operator_notify_queue.json';
}

/**
 * @return array{seq:int,items:list<array<string,mixed>>}
 */
function bench_notify_load(): array
{
    $path = bench_notify_queue_path();
    if (!is_readable($path)) {
        return ['seq' => 0, 'items' => []];
    }
    $raw = file_get_contents($path);
    $j = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($j)) {
        return ['seq' => 0, 'items' => []];
    }
    $seq = isset($j['seq']) ? (int) $j['seq'] : 0;
    $items = isset($j['items']) && is_array($j['items']) ? $j['items'] : [];
    return ['seq' => $seq, 'items' => array_values($items)];
}

/**
 * @param array{seq:int,items:list<array<string,mixed>>} $q
 */
function bench_notify_save(array $q): void
{
    $path = bench_notify_queue_path();
    $tmp = $path . '.tmp';
    $payload = json_encode(
        [
            'seq' => (int) ($q['seq'] ?? 0),
            'items' => array_values($q['items'] ?? []),
        ],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    if ($payload === false) {
        throw new RuntimeException('Не удалось сериализовать очередь уведомлений');
    }
    if (file_put_contents($tmp, $payload, LOCK_EX) === false) {
        throw new RuntimeException('Не удалось записать очередь уведомлений');
    }
    if (!@rename($tmp, $path)) {
        @unlink($path);
        if (!@rename($tmp, $path)) {
            throw new RuntimeException('Не удалось сохранить очередь уведомлений');
        }
    }
}

/**
 * Удалить записи старше TTL и обрезать хвост.
 *
 * @param array{seq:int,items:list<array<string,mixed>>} $q
 * @return array{seq:int,items:list<array<string,mixed>>}
 */
function bench_notify_prune(array $q, int $ttlSec = 900, int $keep = 30): array
{
    $now = time();
    $items = [];
    foreach ($q['items'] as $it) {
        if (!is_array($it)) {
            continue;
        }
        $ts = isset($it['ts']) ? strtotime((string) $it['ts']) : 0;
        if ($ts > 0 && ($now - $ts) > $ttlSec) {
            continue;
        }
        $items[] = $it;
    }
    if (count($items) > $keep) {
        $items = array_slice($items, -$keep);
    }
    $q['items'] = $items;
    return $q;
}

function bench_notify_json(array $payload, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = isset($_GET['action']) ? trim((string) $_GET['action']) : '';

try {
    if ($action === 'push') {
        if ($method !== 'POST') {
            bench_notify_json(['ok' => false, 'error' => 'POST only'], 405);
        }
        auth_require_admin_role(AUTH_ROLE_MONITOR);
        $body = json_decode((string) file_get_contents('php://input'), true);
        if (!is_array($body)) {
            $body = [];
        }
        $orderNumber = trim((string) ($body['orderNumber'] ?? $body['number'] ?? 'ТМ00-ТЕСТ001'));
        if ($orderNumber === '') {
            $orderNumber = 'ТМ00-ТЕСТ001';
        }
        $kind = trim((string) ($body['kind'] ?? 'corrector'));
        if ($kind !== 'complex' && $kind !== 'corrector') {
            $kind = 'corrector';
        }
        $message = trim((string) ($body['message'] ?? ''));
        if ($message === '') {
            $message = 'Тестовое уведомление администратора';
        }

        $q = bench_notify_prune(bench_notify_load());
        $q['seq'] = (int) $q['seq'] + 1;
        $item = [
            'id' => $q['seq'],
            'ts' => gmdate('c'),
            'orderNumber' => $orderNumber,
            'kind' => $kind,
            'kindLabel' => $kind === 'complex' ? 'комплекс' : 'корректор',
            'message' => $message,
            'test' => true,
        ];
        $q['items'][] = $item;
        $q = bench_notify_prune($q);
        bench_notify_save($q);

        bench_notify_json(['ok' => true, 'item' => $item]);
    }

    if ($action === 'poll') {
        if ($method !== 'GET') {
            bench_notify_json(['ok' => false, 'error' => 'GET only'], 405);
        }
        // Оператор или админ (админ может проверить poll у себя)
        auth_session_start();
        $isAdmin = !empty($_SESSION['admin']);
        if (!$isAdmin) {
            bench_require_operator_session();
        }
        $since = isset($_GET['since']) ? (int) $_GET['since'] : 0;
        $q = bench_notify_prune(bench_notify_load());
        // периодически сохраняем prune
        static $saved = false;
        if (!$saved) {
            try {
                bench_notify_save($q);
            } catch (Throwable $_e) {
            }
            $saved = true;
        }
        $fresh = [];
        foreach ($q['items'] as $it) {
            if (!is_array($it)) {
                continue;
            }
            $id = isset($it['id']) ? (int) $it['id'] : 0;
            if ($id > $since) {
                $fresh[] = $it;
            }
        }
        bench_notify_json([
            'ok' => true,
            'since' => $since,
            'latestId' => (int) ($q['seq'] ?? 0),
            'items' => $fresh,
        ]);
    }

    bench_notify_json(['ok' => false, 'error' => 'Unknown action (push|poll)'], 400);
} catch (RuntimeException $e) {
    $code = str_contains($e->getMessage(), 'оператор') || str_contains($e->getMessage(), 'сесси') ? 403 : 400;
    if (str_contains(mb_strtolower($e->getMessage()), 'админ') || str_contains($e->getMessage(), 'Unauthorized')) {
        $code = 401;
    }
    bench_notify_json(['ok' => false, 'error' => $e->getMessage()], $code);
} catch (Throwable $e) {
    bench_notify_json(['ok' => false, 'error' => 'Server error'], 500);
}
