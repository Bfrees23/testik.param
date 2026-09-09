<?php
declare(strict_types=1);

/**
 * Текстовый журнал действий сайта: src/logs/site-actions-YYYY-MM-DD.txt
 */

if (!defined('SITE_FILE_LOG_LOADED')) {
    define('SITE_FILE_LOG_LOADED', true);
}

/** @var array<string,mixed>|null */
$GLOBALS['SITE_FILE_LOG_RESPONSE'] = null;

function site_file_logs_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    if (defined('LOGS_PATH')) {
        $dir = LOGS_PATH;
    } else {
        $dir = dirname(__DIR__, 2) . '/logs';
    }
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    return $dir;
}

function site_file_log_path_for_date(?string $date = null): string
{
    $d = $date ?? date('Y-m-d');
    return site_file_logs_dir() . '/site-actions-' . $d . '.txt';
}

/** @param mixed $value */
function site_file_log_sanitize_value($value)
{
    if (!is_array($value)) {
        if (is_string($value) && strlen($value) > 500) {
            return substr($value, 0, 500) . '…';
        }
        return $value;
    }
    $out = [];
    foreach ($value as $k => $v) {
        $key = strtolower((string) $k);
        if (
            preg_match('/(password|passwd|secret|token|lkg|manufacturerlkg|supplierlkg|keyhex|crypt)/i', $key)
        ) {
            $out[$k] = '[redacted]';
            continue;
        }
        $out[$k] = site_file_log_sanitize_value($v);
    }
    return $out;
}

function site_file_log_client_ip(): string
{
    $xff = trim((string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? ''));
    if ($xff !== '') {
        $parts = explode(',', $xff);
        return trim($parts[0]);
    }
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '-');
}

/** Простой rate limit: не более $maxEvents событий с IP за $windowSec секунд. */
function site_action_log_rate_allow(string $ip, int $maxEvents = 120, int $windowSec = 60): bool
{
    if ($ip === '' || $ip === '-') {
        return true;
    }
    $file = site_file_logs_dir() . '/.rate-' . md5($ip) . '.json';
    $now = time();
    $data = ['t' => $now, 'n' => 0];
    if (is_readable($file)) {
        $raw = file_get_contents($file);
        $decoded = is_string($raw) ? json_decode($raw, true) : null;
        if (is_array($decoded) && isset($decoded['t'], $decoded['n'])) {
            $data = $decoded;
        }
    }
    if ($now - (int) $data['t'] >= $windowSec) {
        $data = ['t' => $now, 'n' => 0];
    }
    if ((int) $data['n'] >= $maxEvents) {
        return false;
    }
    $data['n'] = (int) $data['n'] + 1;
    file_put_contents($file, json_encode($data));

    return true;
}

function site_file_log_session_context(): array
{
    $ctx = [
        'operatorLogin' => null,
        'operatorName' => null,
        'workstationId' => null,
        'sessionOrder' => null,
    ];
    if (session_status() !== PHP_SESSION_ACTIVE) {
        return $ctx;
    }
    if (!empty($_SESSION['bench_operator']) && is_array($_SESSION['bench_operator'])) {
        $op = $_SESSION['bench_operator'];
        $ctx['operatorLogin'] = $op['LOGIN'] ?? $op['login'] ?? null;
        $ctx['operatorName'] = $op['DISPLAY_NAME'] ?? $op['displayName'] ?? null;
    }
    if (!empty($_SESSION['bench_workstation_id'])) {
        $ctx['workstationId'] = (int) $_SESSION['bench_workstation_id'];
    }
    if (!empty($_SESSION['bench_order_session_id'])) {
        $ctx['sessionOrderId'] = (int) $_SESSION['bench_order_session_id'];
    }
    if (!empty($_SESSION['admin'])) {
        $ctx['admin'] = true;
    }
    return $ctx;
}

function site_file_log_request_action(): ?string
{
    if (isset($_GET['action']) && is_string($_GET['action']) && $_GET['action'] !== '') {
        return trim($_GET['action']);
    }
    $raw = $GLOBALS['SITE_FILE_LOG_BODY'] ?? null;
    if (is_array($raw) && !empty($raw['action'])) {
        return trim((string) $raw['action']);
    }
    return null;
}

function site_file_log_capture_body(): void
{
    if (isset($GLOBALS['SITE_FILE_LOG_BODY'])) {
        return;
    }
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($method !== 'POST' && $method !== 'PUT' && $method !== 'PATCH') {
        $GLOBALS['SITE_FILE_LOG_BODY'] = [];
        return;
    }
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || trim($raw) === '') {
        $GLOBALS['SITE_FILE_LOG_BODY'] = [];
        return;
    }
    $data = json_decode($raw, true);
    $GLOBALS['SITE_FILE_LOG_BODY'] = is_array($data) ? $data : ['_raw' => substr($raw, 0, 200)];
}

/**
 * @param array<string,mixed> $context
 */
function site_file_log(string $channel, string $action, array $context = []): void
{
    try {
        $ts = date('Y-m-d H:i:s');
        $lineCtx = array_merge(
            site_file_log_session_context(),
            site_file_log_sanitize_value($context)
        );
        $parts = [
            '[' . $ts . ']',
            '[' . $channel . ']',
            $action,
        ];
        $op = $lineCtx['operatorLogin'] ?? null;
        if ($op) {
            $parts[] = 'op=' . $op;
        }
        if (!empty($lineCtx['workstationId'])) {
            $parts[] = 'ws=' . $lineCtx['workstationId'];
        }
        if (!empty($lineCtx['sessionOrderId'])) {
            $parts[] = 'sess=' . $lineCtx['sessionOrderId'];
        }
        if (!empty($lineCtx['admin'])) {
            $parts[] = 'admin=1';
        }
        $ip = site_file_log_client_ip();
        if ($ip !== '-') {
            $parts[] = 'ip=' . $ip;
        }
        unset($lineCtx['operatorLogin'], $lineCtx['operatorName'], $lineCtx['workstationId'], $lineCtx['sessionOrderId'], $lineCtx['admin']);
        if ($lineCtx !== []) {
            $json = json_encode($lineCtx, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if (is_string($json) && $json !== '{}' && $json !== '[]') {
                $parts[] = $json;
            }
        }
        $line = implode(' ', $parts);
        file_put_contents(site_file_log_path_for_date(), $line . "\n", FILE_APPEND | LOCK_EX);
    } catch (Throwable) {
        // logging must not break the app
    }
}

/**
 * @param array<string,mixed> $payload
 */
function site_file_log_set_response(array $payload, int $code = 200): void
{
    $GLOBALS['SITE_FILE_LOG_RESPONSE'] = [
        'code' => $code,
        'payload' => site_file_log_sanitize_value($payload),
    ];
}

function site_file_log_on_shutdown(): void
{
    if (php_sapi_name() === 'cli') {
        return;
    }
    $script = basename((string) ($_SERVER['SCRIPT_FILENAME'] ?? 'unknown'));
    if (!str_contains($script, '.php')) {
        return;
    }
    $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
    $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    $action = site_file_log_request_action();
    $resp = $GLOBALS['SITE_FILE_LOG_RESPONSE'] ?? null;
    $code = is_array($resp) ? (int) ($resp['code'] ?? 200) : http_response_code();
    if ($code === false) {
        $code = 200;
    }
    $ctx = [
        'script' => $script,
        'method' => $method,
        'uri' => $uri,
        'http' => $code,
    ];
    if ($action !== null) {
        $ctx['action'] = $action;
    }
    if (is_array($resp) && isset($resp['payload'])) {
        $p = $resp['payload'];
        if (isset($p['ok'])) {
            $ctx['ok'] = $p['ok'];
        }
        if (isset($p['error'])) {
            $ctx['error'] = $p['error'];
        }
        if (isset($p['eventType'])) {
            $ctx['eventType'] = $p['eventType'];
        }
        if (isset($p['eventId'])) {
            $ctx['eventId'] = $p['eventId'];
        }
    }
    site_file_log('api', $action ?? $script, $ctx);
}

function site_file_log_register_shutdown(): void
{
    static $registered = false;
    if ($registered) {
        return;
    }
    $registered = true;
    site_file_log_capture_body();
    register_shutdown_function('site_file_log_on_shutdown');
}

site_file_log_register_shutdown();
