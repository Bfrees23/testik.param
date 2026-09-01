<?php
/**
 * Общая логика авторизации (админка).
 * Окружение: **prod** — ветка project (`prod.yml`), **dev** — ветка dev (`dev.yml`).
 */
declare(strict_types=1);

require_once dirname(__DIR__) . '/config/config.php';

function auth_data_dir(): string
{
    $d = BASE_PATH . '/data';
    if (!is_dir($d)) {
        mkdir($d, 0755, true);
    }
    return $d;
}

function auth_request_is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
        return true;
    }
    $fwd = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
    return $fwd === 'https';
}

function auth_session_start(): void
{
    if (session_status() !== PHP_SESSION_NONE) {
        return;
    }
    ini_set('session.use_strict_mode', '1');
    $https = auth_request_is_https();
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => $https,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    // Отдельное имя для HTTP: иначе старый Secure-cookie bench_sid с :8443
    // блокирует Set-Cookie по http://IP/ (браузер отвергает non-Secure с тем же именем).
    session_name($https ? 'bench_sid' : 'bench_sid_http');
    session_start();
}

function auth_hash_file(): string
{
    return auth_data_dir() . '/admin_password.hash';
}

/**
 * Хеш пароля админа. Fail-closed: без файла и без ADMIN_PASSWORD хеш не создаётся.
 */
function auth_ensure_password_hash(): string
{
    $f = auth_hash_file();
    if (is_readable($f)) {
        $stored = trim((string) file_get_contents($f));
        if ($stored !== '') {
            return $stored;
        }
    }
    $pwd = trim((string) (getenv('ADMIN_PASSWORD') ?: ''));
    if ($pwd === '' || strlen($pwd) < 8 || strtolower($pwd) === 'admin') {
        throw new RuntimeException(
            'ADMIN_PASSWORD не задан или слишком слабый (мин. 8 символов, не «admin»). Задайте в .env.'
        );
    }
    $hash = password_hash($pwd, PASSWORD_DEFAULT);
    if ($hash === false) {
        throw new RuntimeException('password_hash failed');
    }
    file_put_contents($f, $hash);
    @chmod($f, 0600);
    error_log('bench: создан data/admin_password.hash из ADMIN_PASSWORD.');
    return $hash;
}

function auth_verify_password(string $password): bool
{
    try {
        $stored = auth_ensure_password_hash();
    } catch (Throwable) {
        return false;
    }
    return password_verify($password, $stored);
}

/** Клиентский IP для rate-limit (с учётом одного X-Forwarded-For). */
function auth_client_ip(): string
{
    $xff = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
    if ($xff !== '') {
        $parts = explode(',', $xff);
        return trim($parts[0]);
    }
    return (string) ($_SERVER['REMOTE_ADDR'] ?? '');
}

/**
 * Простой file-based rate limit / lockout.
 * @return array{ok:bool, retryAfter?:int, remaining?:int}
 */
function auth_rate_limit_check(string $bucket, int $maxAttempts = 8, int $windowSec = 300): array
{
    $ip = auth_client_ip();
    if ($ip === '') {
        return ['ok' => true];
    }
    $dir = auth_data_dir() . '/rate-limit';
    if (!is_dir($dir)) {
        mkdir($dir, 0750, true);
    }
    $file = $dir . '/' . preg_replace('/[^a-zA-Z0-9._-]/', '_', $bucket) . '-' . md5($ip) . '.json';
    $now = time();
    $data = ['t' => $now, 'n' => 0, 'lockUntil' => 0];
    if (is_readable($file)) {
        $raw = file_get_contents($file);
        $decoded = is_string($raw) ? json_decode($raw, true) : null;
        if (is_array($decoded)) {
            $data = array_merge($data, $decoded);
        }
    }
    $lockUntil = (int) ($data['lockUntil'] ?? 0);
    if ($lockUntil > $now) {
        return ['ok' => false, 'retryAfter' => $lockUntil - $now];
    }
    if ($now - (int) $data['t'] >= $windowSec) {
        $data = ['t' => $now, 'n' => 0, 'lockUntil' => 0];
    }
    if ((int) $data['n'] >= $maxAttempts) {
        $data['lockUntil'] = $now + $windowSec;
        file_put_contents($file, json_encode($data));
        @chmod($file, 0600);
        return ['ok' => false, 'retryAfter' => $windowSec];
    }
    return ['ok' => true, 'remaining' => $maxAttempts - (int) $data['n']];
}

function auth_rate_limit_fail(string $bucket, int $maxAttempts = 8, int $windowSec = 300): void
{
    $ip = auth_client_ip();
    if ($ip === '') {
        return;
    }
    $dir = auth_data_dir() . '/rate-limit';
    if (!is_dir($dir)) {
        mkdir($dir, 0750, true);
    }
    $file = $dir . '/' . preg_replace('/[^a-zA-Z0-9._-]/', '_', $bucket) . '-' . md5($ip) . '.json';
    $now = time();
    $data = ['t' => $now, 'n' => 0, 'lockUntil' => 0];
    if (is_readable($file)) {
        $raw = file_get_contents($file);
        $decoded = is_string($raw) ? json_decode($raw, true) : null;
        if (is_array($decoded)) {
            $data = array_merge($data, $decoded);
        }
    }
    if ($now - (int) $data['t'] >= $windowSec) {
        $data = ['t' => $now, 'n' => 0, 'lockUntil' => 0];
    }
    $data['n'] = (int) $data['n'] + 1;
    if ((int) $data['n'] >= $maxAttempts) {
        $data['lockUntil'] = $now + $windowSec;
    }
    file_put_contents($file, json_encode($data));
    @chmod($file, 0600);
}

function auth_rate_limit_clear(string $bucket): void
{
    $ip = auth_client_ip();
    if ($ip === '') {
        return;
    }
    $dir = auth_data_dir() . '/rate-limit';
    $file = $dir . '/' . preg_replace('/[^a-zA-Z0-9._-]/', '_', $bucket) . '-' . md5($ip) . '.json';
    if (is_file($file)) {
        @unlink($file);
    }
}

function auth_set_password(string $newPlain): void
{
    $hash = password_hash($newPlain, PASSWORD_DEFAULT);
    if ($hash === false) {
        throw new RuntimeException('password_hash failed');
    }
    file_put_contents(auth_hash_file(), $hash);
}

function auth_is_admin(): bool
{
    auth_session_start();
    return !empty($_SESSION['admin']) && $_SESSION['admin'] === true;
}

function auth_login(): void
{
    auth_session_start();
    $_SESSION['admin'] = true;
    $_SESSION['login_at'] = time();
    session_regenerate_id(true);
}

function auth_logout(): void
{
    auth_session_start();
    // Не уничтожаем всю PHP-сессию: оператор / заказ / рабочее место живут в тех же ключах.
    unset($_SESSION['admin'], $_SESSION['login_at']);
}

function auth_require_admin(): void
{
    if (!auth_is_admin()) {
        http_response_code(401);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['success' => false, 'error' => 'Требуется вход администратора'], JSON_UNESCAPED_UNICODE);
        exit;
    }
}

/**
 * Общий PIN (fallback): BENCH_OPERATOR_PIN / OPERATOR_PIN.
 * Персональные: BENCH_OPERATOR_PINS="Фамилия:Имя:PIN,Фамилия2::PIN2"
 */
function bench_shared_operator_pin(): string
{
    return trim((string) (getenv('BENCH_OPERATOR_PIN') ?: getenv('OPERATOR_PIN') ?: ''));
}

/**
 * @return list<array{lastName:string,firstName:?string,pin:string}>
 */
function bench_parse_operator_pins_env(): array
{
    $raw = trim((string) (getenv('BENCH_OPERATOR_PINS') ?: ''));
    if ($raw === '') {
        return [];
    }
    $out = [];
    foreach (preg_split('/\s*[,;]\s*/u', $raw) ?: [] as $part) {
        $part = trim((string) $part);
        if ($part === '') {
            continue;
        }
        $bits = explode(':', $part);
        if (count($bits) < 3) {
            continue;
        }
        $last = trim((string) $bits[0]);
        $first = trim((string) $bits[1]);
        $pin = trim((string) implode(':', array_slice($bits, 2)));
        if ($last === '' || $pin === '') {
            continue;
        }
        $out[] = [
            'lastName' => $last,
            'firstName' => $first !== '' ? $first : null,
            'pin' => $pin,
        ];
    }
    return $out;
}

function bench_env_pin_for_operator(string $lastName, ?string $firstName): ?string
{
    $lastName = trim($lastName);
    $first = $firstName !== null ? trim($firstName) : '';
    if ($lastName === '') {
        return null;
    }
    $norm = static function (string $s): string {
        $s = trim($s);
        return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
    };
    foreach (bench_parse_operator_pins_env() as $row) {
        if ($norm($row['lastName']) !== $norm($lastName)) {
            continue;
        }
        $rowFirst = $row['firstName'] !== null ? trim((string) $row['firstName']) : '';
        if ($rowFirst === '' || $norm($rowFirst) === $norm($first)) {
            return $row['pin'];
        }
    }
    return null;
}

/** PIN обязателен, если задан общий, персональные в .env или жёсткий флаг. */
function bench_operator_pin_required(): bool
{
    if (bench_shared_operator_pin() !== '') {
        return true;
    }
    if (bench_parse_operator_pins_env() !== []) {
        return true;
    }
    return bench_operator_pin_enforced();
}

/**
 * Жёсткое требование PIN: BENCH_REQUIRE_OPERATOR_PIN=1.
 */
function bench_operator_pin_enforced(): bool
{
    $flag = getenv('BENCH_REQUIRE_OPERATOR_PIN');
    if ($flag === false) {
        return false;
    }
    $v = strtolower(trim((string) $flag));
    return in_array($v, ['1', 'true', 'yes', 'on'], true);
}

/**
 * Проверка PIN для конкретного оператора (hash в БД → персональный .env → общий .env).
 *
 * @param array<string,mixed>|null $operatorRow строка TM07_OPERATOR (может содержать PIN_HASH)
 */
function bench_verify_operator_pin_for(
    ?string $pin,
    string $lastName,
    ?string $firstName = null,
    ?array $operatorRow = null
): bool {
    $pin = trim((string) ($pin ?? ''));
    $hasHash = is_array($operatorRow) && !empty($operatorRow['PIN_HASH']);
    $personal = bench_env_pin_for_operator($lastName, $firstName);
    $shared = bench_shared_operator_pin();
    $anyConfigured = $hasHash || $personal !== null || $shared !== '' || bench_parse_operator_pins_env() !== [];

    if (!$anyConfigured) {
        return !bench_operator_pin_enforced();
    }
    if ($pin === '') {
        return false;
    }
    if ($hasHash) {
        return password_verify($pin, (string) $operatorRow['PIN_HASH']);
    }
    if ($personal !== null) {
        return hash_equals($personal, $pin);
    }
    if ($shared !== '') {
        return hash_equals($shared, $pin);
    }
    return false;
}

/** @deprecated используйте bench_verify_operator_pin_for */
function bench_verify_operator_pin(?string $pin): bool
{
    $shared = bench_shared_operator_pin();
    if (bench_operator_pin_enforced() && $shared === '' && bench_parse_operator_pins_env() === []) {
        return false;
    }
    if ($shared === '' && bench_parse_operator_pins_env() === []) {
        return true;
    }
    if ($shared === '') {
        return false;
    }
    return hash_equals($shared, trim((string) ($pin ?? '')));
}

function bench_hash_operator_pin(string $pin): string
{
    return password_hash(trim($pin), PASSWORD_DEFAULT);
}
