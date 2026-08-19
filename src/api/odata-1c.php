<?php
/**
 * Прокси к OData 1С (обход CORS для браузера).
 * Авторизация: HTTP Basic — переменные ODATA_1C_USER / ODATA_1C_PASSWORD или в параметре «base» как
 * http://логин:пароль@srv-1c/…/standard.odata (страница «Заказ 1С»: отдельные поля логин/пароль).
 *
 * База URL: ODATA_1C_BASE или http://srv-1c/erp/odata/standard.odata
 * Если в Docker не резолвится srv-1c: задайте ODATA_1C_HOST_IP (IP сервера 1С в LAN) — хост в URL заменится перед curl.
 *
 * Переменные ODATA_* из окружения (docker-compose) и дополнительно из корневого `.env`, если ключи отсутствуют или
 * ODATA_1C_HOST_IP пустой (curl_errno 6 в контейнере из-за LAN-DNS).
 *
 * GET path — путь и query после базы, например:
 * Document_ЗаказНаПроизводство2_2?$format=json&$filter=Number%20eq%20'TM00-000001'
 */
declare(strict_types=1);

/**
 * Корень репозитория (родитель каталога `src`).
 */
function odata_repo_root(): string
{
    return dirname(__DIR__, 2);
}

/**
 * Подтягивает ключи ODATA_* из `.env`, если они не переданы средой Docker / php-fpm.
 */
function odata_bootstrap_odata_env_from_dotenv(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    $path = odata_repo_root() . '/.env';
    if (!is_readable($path)) {
        return;
    }
    $raw = file_get_contents($path);
    if ($raw === false || $raw === '') {
        return;
    }
    foreach (preg_split('/\r\n|\r|\n/', $raw) as $line) {
        $line = trim((string) $line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        if (!str_contains($line, '=')) {
            continue;
        }
        if (preg_match('/^export\s+/i', $line)) {
            $line = preg_replace('/^export\s+/i', '', $line);
        }
        [$k, $v] = explode('=', $line, 2);
        $key = trim((string) $k);
        if ($key === '' || !str_starts_with($key, 'ODATA_')) {
            continue;
        }
        if ($key !== 'ODATA_1C_HOST_IP' && getenv($key) !== false) {
            continue;
        }
        $value = trim((string) $v, " \t");
        $len = strlen($value);
        if (
            $len >= 2
            && (($value[0] === '"' && $value[$len - 1] === '"')
                || ($value[0] === "'" && $value[$len - 1] === "'"))
        ) {
            $value = substr($value, 1, -1);
        }
        if ($key === 'ODATA_1C_HOST_IP') {
            $cur = getenv('ODATA_1C_HOST_IP');
            $curTrim = $cur !== false ? trim((string) $cur) : '';
            if ($curTrim !== '') {
                continue;
            }
            if (trim($value, " \t") === '') {
                continue;
            }
        }
        putenv($key . '=' . $value);
        $_ENV[$key] = $value;
    }
}

odata_bootstrap_odata_env_from_dotenv();

require_once dirname(__DIR__) . '/config/config.php';

/**
 * Кодирует query OData в вид, допустимый для URI (ASCII + %XX для UTF-8).
 * Иначе кириллица в $filter (номер заказа) попадает в curl как «сырой» UTF-8 — libcurl может вернуть ошибку.
 */
function odata_percent_encode_query(string $queryWithQuestion): string
{
    if ($queryWithQuestion === '') {
        return '';
    }
    if ($queryWithQuestion[0] !== '?') {
        return $queryWithQuestion;
    }
    $q = substr($queryWithQuestion, 1);
    if ($q === '') {
        return '?';
    }
    $pairs = explode('&', $q);
    $out = [];
    foreach ($pairs as $pair) {
        if ($pair === '') {
            continue;
        }
        $eq = strpos($pair, '=');
        if ($eq === false) {
            $out[] = rawurlencode($pair);
            continue;
        }
        $name = substr($pair, 0, $eq);
        $value = substr($pair, $eq + 1);
        $out[] = rawurlencode($name) . '=' . rawurlencode($value);
    }

    return '?' . implode('&', $out);
}

/** Убирает user:password из authority URL перед CURL с CURLOPT_USERPWD. */
function odata_strip_url_credentials(string $url): string
{
    $p = parse_url($url);
    if (!is_array($p) || empty($p['host'])) {
        return $url;
    }
    if (empty($p['user']) && empty($p['pass'])) {
        return $url;
    }
    $scheme = ($p['scheme'] ?? 'http') . '://';
    $host = $p['host'];
    $port = isset($p['port']) ? ':' . $p['port'] : '';
    $path = $p['path'] ?? '';
    $query = isset($p['query']) ? '?' . $p['query'] : '';
    $fragment = isset($p['fragment']) ? '#' . $p['fragment'] : '';

    return $scheme . $host . $port . $path . $query . $fragment;
}

/** Для X-OData-Request-URL — без пароля из URL. */
function odata_redact_url_userinfo(string $url): string
{
    $p = parse_url($url);
    if (!is_array($p) || (empty($p['user']) && empty($p['pass']))) {
        return $url;
    }
    $scheme = ($p['scheme'] ?? 'http') . '://';
    $host = $p['host'] ?? '';
    $port = isset($p['port']) ? ':' . $p['port'] : '';
    $path = $p['path'] ?? '';
    $query = isset($p['query']) ? '?' . $p['query'] : '';
    $fragment = isset($p['fragment']) ? '#' . $p['fragment'] : '';

    return $scheme . '***:***@' . $host . $port . $path . $query . $fragment;
}

/**
 * Basic Auth: переменные ODATA_1C_USER / ODATA_1C_PASSWORD или форма http://логин:пароль@хост/... в параметре «base».
 *
 * @return array{user: string, pass: string}
 */
function odata_resolve_basic_credentials(string $url): array
{
    $p = parse_url($url);
    $fromUrlUser = isset($p['user']) ? (string) rawurldecode($p['user']) : '';
    $fromUrlPass = isset($p['pass']) ? (string) rawurldecode($p['pass']) : '';
    $eu = getenv('ODATA_1C_USER');
    $ep = getenv('ODATA_1C_PASSWORD');
    $eu = ($eu !== false && trim((string) $eu) !== '') ? trim((string) $eu) : '';
    $ep = $ep !== false ? (string) $ep : '';

    if ($eu !== '') {
        return ['user' => $eu, 'pass' => $ep];
    }

    return ['user' => $fromUrlUser, 'pass' => $fromUrlPass];
}

/**
 * Подстановка IP вместо LAN-имени для curl внутри Docker (обычно нет записи DNS типа srv-1c).
 * Возвращает [url, виртуальный Host] — при запросе по IP IIS/публикация часто требует Host: как у публикации (имя узла, не IP).
 * Если задан ODATA_1C_HOST_IP:
 * — по умолчанию заменяется только хост ODATA_1C_LAN_HOST (по умолчанию srv-1c);
 * — если ODATA_1C_REPLACE_ANY_LAN_HOST=1, заменяется любое имя, кроме localhost и уже заданного IP.
 * ODATA_1C_HTTP_HOST — явный Host (напр. srv-1c.tehnomer.arz из ping), если сайт привязан к FQDN.
 *
 * @return array{0: string, 1: string|null}
 */
function odata_apply_host_ip_override(string $url): array
{
    $ip = getenv('ODATA_1C_HOST_IP');
    if ($ip === false || trim((string) $ip) === '') {
        return [$url, null];
    }
    $ip = trim((string) $ip);
    if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
        return [$url, null];
    }

    $p = parse_url($url);
    if (!is_array($p) || empty($p['host'])) {
        return [$url, null];
    }
    $host = (string) $p['host'];
    if ($host === '') {
        return [$url, null];
    }
    $hostLower = strtolower($host);
    if ($hostLower === 'localhost' || $hostLower === '127.0.0.1' || $hostLower === '[::1]') {
        return [$url, null];
    }
    if ($hostLower === 'host.docker.internal') {
        return [$url, null];
    }
    if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
        return [$url, null];
    }

    $replaceAny = getenv('ODATA_1C_REPLACE_ANY_LAN_HOST');
    $any = $replaceAny !== false && in_array(trim((string) strtolower((string) $replaceAny)), ['1', 'true', 'yes', 'on'], true);

    $lanHost = getenv('ODATA_1C_LAN_HOST');
    $lanHost = ($lanHost !== false && trim((string) $lanHost) !== '') ? trim((string) $lanHost) : 'srv-1c';

    if (!$any && strcasecmp($host, $lanHost) !== 0) {
        return [$url, null];
    }

    $originalHostFromUrl = $host;

    $portForHost = $p['port'] ?? null;

    $p['host'] = $ip;

    $scheme = ($p['scheme'] ?? 'http') . '://';
    $auth = '';
    if (!empty($p['user'])) {
        $auth = $p['user'] . (!empty($p['pass']) ? ':' . $p['pass'] : '') . '@';
    }
    $hostOut = $p['host'];
    $port = isset($p['port']) ? ':' . $p['port'] : '';
    $path = $p['path'] ?? '';
    $query = isset($p['query']) ? '?' . $p['query'] : '';
    $fragment = isset($p['fragment']) ? '#' . $p['fragment'] : '';

    $built = $scheme . $auth . $hostOut . $port . $path . $query . $fragment;

    $explicit = getenv('ODATA_1C_HTTP_HOST');
    $virtualHost = ($explicit !== false && trim((string) $explicit) !== '')
        ? trim((string) $explicit)
        : $originalHostFromUrl;

    $sch = strtolower((string) ($p['scheme'] ?? 'http'));
    $defPort = ($sch === 'https') ? 443 : 80;
    if (
        $portForHost !== null
        && (int) $portForHost !== $defPort
    ) {
        $virtualHost .= ':' . $portForHost;
    }

    return [$built, $virtualHost];
}

/**
 * Базовый URL OData (без query): ODATA_1C_BASE или http://srv-1c/erp/odata/standard.odata
 */
function odata_default_base_raw(): string
{
    $base = getenv('ODATA_1C_BASE');
    if ($base === false || trim((string) $base) === '') {
        $base = 'http://srv-1c/erp/odata/standard.odata';
    }
    return rtrim(trim((string) $base), '/');
}

/**
 * Хосты, на которые разрешён клиентский base и env Basic Auth (защита от SSRF / утечки учётки).
 *
 * @return list<string>
 */
function odata_allowed_hosts(): array
{
    $hosts = [];
    $add = static function (?string $h) use (&$hosts): void {
        $h = strtolower(trim((string) $h));
        if ($h === '') {
            return;
        }
        $hosts[$h] = true;
    };

    foreach (['ODATA_1C_BASE', 'ODATA_1C_LAN_HOST', 'ODATA_1C_HTTP_HOST', 'ODATA_1C_HOST_IP'] as $envKey) {
        $v = getenv($envKey);
        if ($v === false || trim((string) $v) === '') {
            continue;
        }
        $v = trim((string) $v);
        if ($envKey === 'ODATA_1C_BASE' || preg_match('#^https?://#i', $v)) {
            $p = parse_url(preg_match('#^https?://#i', $v) ? $v : ('http://' . $v));
            if (is_array($p) && !empty($p['host'])) {
                $add((string) $p['host']);
            }
        } else {
            $add($v);
        }
    }
    $add('srv-1c');
    $extra = getenv('ODATA_1C_ALLOWED_HOSTS');
    if ($extra !== false && trim((string) $extra) !== '') {
        foreach (preg_split('/[\s,;]+/', (string) $extra) as $part) {
            $add($part);
        }
    }

    return array_keys($hosts);
}

function odata_host_is_allowed(string $host): bool
{
    $host = strtolower(trim($host));
    if ($host === '') {
        return false;
    }
    return in_array($host, odata_allowed_hosts(), true);
}

/**
 * Нормализует base до …/standard.odata; клиентский base — только с allowlist-хоста.
 */
function odata_resolve_base(?string $clientBase = null): string
{
    $base = odata_default_base_raw();
    $clientBase = $clientBase !== null ? trim($clientBase) : '';
    if ($clientBase !== '' && !preg_match('#^https?://#i', $clientBase)) {
        $clientBase = 'http://' . ltrim($clientBase, '/');
    }
    if ($clientBase !== '') {
        $parsed = parse_url($clientBase);
        if (
            is_array($parsed)
            && isset($parsed['scheme'], $parsed['host'])
            && in_array(strtolower($parsed['scheme']), ['http', 'https'], true)
            && odata_host_is_allowed((string) $parsed['host'])
        ) {
            $base = rtrim($clientBase, '/');
        }
        // Иначе игнорируем client base (SSRF / чужой хост) и остаёмся на ODATA_1C_BASE.
    }

    $stdMark = '/standard.odata';
    $bp = parse_url($base);
    if (is_array($bp) && isset($bp['scheme'], $bp['host'], $bp['path'])) {
        $pathB = $bp['path'];
        $pos = stripos($pathB, $stdMark);
        if ($pos !== false) {
            $newPath = substr($pathB, 0, $pos + strlen($stdMark));
            $auth = '';
            if (!empty($bp['user'])) {
                $auth = $bp['user'] . (!empty($bp['pass']) ? ':' . $bp['pass'] : '') . '@';
            }
            $base = $bp['scheme'] . '://' . $auth . $bp['host']
                . (!empty($bp['port']) ? ':' . $bp['port'] : '')
                . $newPath;
            $base = rtrim($base, '/');
        }
    }

    return $base;
}

/** CORS только для same-origin (прокси не для чужих сайтов). */
function odata_send_cors_headers(): void
{
    $origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    if ($origin === '') {
        return;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
    if ($host === '') {
        return;
    }
    $expected = ($https ? 'https://' : 'http://') . $host;
    if (strcasecmp($origin, $expected) === 0) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Credentials: true');
    }
}

function odata_json_exit(array $payload, int $code = 200): never
{
    header('Content-Type: application/json; charset=utf-8');
    odata_send_cors_headers();
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    odata_send_cors_headers();
    header('Access-Control-Allow-Methods: GET, OPTIONS');
    header('Access-Control-Max-Age: 86400');
    http_response_code(204);
    exit;
}
if ($method !== 'GET') {
    odata_json_exit(['error' => 'Method not allowed'], 405);
}

$action = isset($_GET['action']) ? trim((string) $_GET['action']) : '';
if ($action === 'config') {
    $base = odata_resolve_base();
    [$effectiveBase, $virtualHost] = odata_apply_host_ip_override($base);
    $hostIp = getenv('ODATA_1C_HOST_IP');
    $hostIp = ($hostIp !== false && trim((string) $hostIp) !== '') ? trim((string) $hostIp) : null;
    $httpHost = getenv('ODATA_1C_HTTP_HOST');
    $httpHost = ($httpHost !== false && trim((string) $httpHost) !== '') ? trim((string) $httpHost) : null;
    $lanHost = getenv('ODATA_1C_LAN_HOST');
    $lanHost = ($lanHost !== false && trim((string) $lanHost) !== '') ? trim((string) $lanHost) : 'srv-1c';
    $user = getenv('ODATA_1C_USER');
    odata_json_exit([
        'ok' => true,
        'defaultBase' => $base,
        'effectiveBase' => odata_redact_url_userinfo($effectiveBase),
        'hostIp' => $hostIp,
        'httpHost' => $httpHost ?: $virtualHost,
        'lanHost' => $lanHost,
        'authConfigured' => ($user !== false && trim((string) $user) !== ''),
        'defaultEntity' => 'Document_ЗаказНаПроизводство2_2',
        'proxyPath' => '/api/odata-1c.php',
    ]);
}

require_once __DIR__ . '/bench_context.php';
try {
    bench_require_operator_session();
} catch (RuntimeException $e) {
    odata_json_exit(['ok' => false, 'error' => $e->getMessage()], 403);
}

$path = isset($_GET['path']) ? (string) $_GET['path'] : '';
if ($path === '') {
    odata_json_exit(['error' => 'Укажите query-параметр path (путь OData после базы).'], 400);
}

if (str_contains($path, '..') || str_starts_with($path, '//')) {
    header('Content-Type: application/json; charset=utf-8');
    odata_send_cors_headers();
    http_response_code(400);
    echo json_encode(['error' => 'Недопустимый path'], JSON_UNESCAPED_UNICODE);
    exit;
}

$base = odata_resolve_base(isset($_GET['base']) ? trim((string) $_GET['base']) : null);

/** Путь и query из path (один сегмент — имя набора сущностей, без «лишних» частей в base). */
$pathNorm = ltrim($path, '/');
$qPos = strpos($pathNorm, '?');
if ($qPos === false) {
    $pathPart = $pathNorm;
    $queryPart = '';
} else {
    $pathPart = substr($pathNorm, 0, $qPos);
    $queryPart = substr($pathNorm, $qPos);
}

/**
 * Если в «базу» попало имя набора сущностей (копипаст полного URL), убираем последний сегмент пути —
 * иначе получается …/Document_…/Document_…?$format и 1С отвечает: «лишние сегменты в запросе к контейнеру».
 */
$firstSeg = $pathPart === '' ? '' : explode('/', $pathPart, 2)[0];
if ($firstSeg !== '') {
    $baseTrim = rtrim($base, '/');
    $parts = parse_url($baseTrim);
    if (is_array($parts) && isset($parts['scheme'], $parts['host'], $parts['path'])) {
        $segs = array_values(array_filter(explode('/', $parts['path']), static fn ($s) => $s !== ''));
        if ($segs !== []) {
            $last = $segs[count($segs) - 1];
            if (rawurldecode($last) === rawurldecode($firstSeg)) {
                array_pop($segs);
                $newPath = '/' . implode('/', $segs);
                $auth = '';
                if (!empty($parts['user'])) {
                    $auth = $parts['user'] . (!empty($parts['pass']) ? ':' . $parts['pass'] : '') . '@';
                }
                $base = $parts['scheme'] . '://' . $auth . $parts['host']
                    . (!empty($parts['port']) ? ':' . $parts['port'] : '')
                    . $newPath;
            }
        }
    }
}

[$base, $odataCurlVirtualHost] = odata_apply_host_ip_override($base);

/**
 * Один сегмент пути после корня сервиса: кодируем UTF-8 для IRI (не дробим имя на несколько сегментов).
 * Если в имени нет «/», не используем explode — иначе лишние сегменты в 1С.
 */
$queryPart = $queryPart === '' ? '' : odata_percent_encode_query($queryPart);
if ($pathPart === '') {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    odata_send_cors_headers();
    echo json_encode(['error' => 'Пустой путь в path (ожидается имя сущности до ?).'], JSON_UNESCAPED_UNICODE);
    exit;
}
if (!str_contains($pathPart, '/')) {
    $pathEncoded = rawurlencode($pathPart);
} else {
    $segments = array_values(array_filter(explode('/', $pathPart), static fn ($s) => $s !== ''));
    $pathEncoded = implode('/', array_map(static fn (string $s): string => rawurlencode($s), $segments));
}
$url = rtrim($base, '/') . '/' . $pathEncoded . $queryPart;

$urlHost = parse_url($url, PHP_URL_HOST);
$urlHost = is_string($urlHost) ? $urlHost : '';
if ($urlHost === '' || !odata_host_is_allowed($urlHost)) {
    odata_json_exit(
        [
            'error' => 'Хост OData не в allowlist',
            'host' => $urlHost,
            'hint' => 'Задайте ODATA_1C_BASE / ODATA_1C_ALLOWED_HOSTS',
        ],
        400
    );
}

$cred = odata_resolve_basic_credentials($url);
// Env-учётку 1С не отправляем на чужой хост (даже если base прошёл старый путь).
$envUser = getenv('ODATA_1C_USER');
$envUserSet = ($envUser !== false && trim((string) $envUser) !== '');
if ($envUserSet && !odata_host_is_allowed($urlHost)) {
    $cred = ['user' => '', 'pass' => ''];
}
if ($cred['user'] !== '') {
    $url = odata_strip_url_credentials($url);
}

$headers = [
    'Accept: application/json',
    'Accept-Charset: UTF-8',
];
if ($odataCurlVirtualHost !== null && $odataCurlVirtualHost !== '') {
    $headers[] = 'Host: ' . $odataCurlVirtualHost;
}

$ch = curl_init($url);
$opts = [
    CURLOPT_RETURNTRANSFER => true,
    // Без FOLLOWLOCATION: редирект на attacker.com унёс бы Basic Auth.
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_TIMEOUT => 90,
    CURLOPT_HTTPHEADER => $headers,
];
if ($cred['user'] !== '') {
    $opts[CURLOPT_USERPWD] = $cred['user'] . ':' . $cred['pass'];
}
curl_setopt_array($ch, $opts);

$body = curl_exec($ch);
$code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
$curlErrno = curl_errno($ch);
curl_close($ch);

header('Content-Type: application/json; charset=utf-8');
odata_send_cors_headers();
header('X-OData-Request-URL: ' . str_replace(["\r", "\n"], '', odata_redact_url_userinfo($url)));

if ($body === false) {
    http_response_code(502);
    echo json_encode(
        [
            'error' => 'Ошибка HTTP-клиента к 1С',
            'detail' => $err,
            'curl_errno' => $curlErrno,
        ],
        JSON_UNESCAPED_UNICODE
    );
    exit;
}

http_response_code($code >= 100 && $code < 600 ? $code : 500);
echo $body;
