<?php
/**
 * Настройки приборов (админ). Публичное чтение: `?action=public`.
 * Окружение: **prod** (ветка project) / **dev** (ветка разработки).
 */
declare(strict_types=1);

require_once __DIR__ . '/auth_common.php';

header('Content-Type: application/json; charset=utf-8');

$defaultsPath = dirname(__DIR__) . '/config/defaults/device_settings.json';
$storagePath = auth_data_dir() . '/device_settings.json';

/** Подтянуть .env (Docker: смонтирован в /app/.env; локально — корень репо). */
function admin_bootstrap_dotenv(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    $candidates = [
        dirname(__DIR__) . '/.env',
        dirname(__DIR__, 2) . '/.env',
    ];
    foreach ($candidates as $path) {
        if (!is_readable($path)) {
            continue;
        }
        $raw = file_get_contents($path);
        if ($raw === false || $raw === '') {
            continue;
        }
        foreach (preg_split('/\r\n|\r|\n/', $raw) as $line) {
            $line = trim((string) $line);
            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                continue;
            }
            if (preg_match('/^export\s+/i', $line)) {
                $line = (string) preg_replace('/^export\s+/i', '', $line);
            }
            [$k, $v] = explode('=', $line, 2);
            $k = trim($k);
            $v = trim($v, " \t\"'");
            if ($k === '') {
                continue;
            }
            $cur = getenv($k);
            if ($cur !== false && trim((string) $cur) !== '') {
                continue;
            }
            putenv($k . '=' . $v);
            $_ENV[$k] = $v;
        }
        break;
    }
}

function admin_env_string(string $key): string
{
    $v = getenv($key);
    if ($v === false || trim((string) $v) === '') {
        $v = $_ENV[$key] ?? '';
    }
    return trim((string) $v);
}

/**
 * Ключи ЛКГ из .env, если в device_settings.json пусто.
 * TM07_SUPPLIER_LKG_HEX / TM07_MANUFACTURER_LKG_HEX (формат: "AD 9E A9 C0").
 *
 * @param array<string, mixed> $settings
 * @return array<string, mixed>
 */
function admin_apply_env_lkg_overrides(array $settings): array
{
    admin_bootstrap_dotenv();
    if (!isset($settings['tm07']) || !is_array($settings['tm07'])) {
        $settings['tm07'] = [];
    }
    if (!isset($settings['benchRegisters']) || !is_array($settings['benchRegisters'])) {
        $settings['benchRegisters'] = [];
    }

    $supplier = admin_env_string('TM07_SUPPLIER_LKG_HEX');
    if ($supplier === '') {
        $supplier = admin_env_string('TM07_CORR_LKG_HEX');
    }
    $mfg = admin_env_string('TM07_MANUFACTURER_LKG_HEX');

    $curSup = trim((string) ($settings['tm07']['supplierLkgHex'] ?? ''));
    if ($curSup === '' && $supplier !== '') {
        $settings['tm07']['supplierLkgHex'] = $supplier;
    }
    $curMfg = trim((string) ($settings['tm07']['manufacturerLkgHex'] ?? ''));
    if ($curMfg === '' && $mfg !== '') {
        $settings['tm07']['manufacturerLkgHex'] = $mfg;
    }
    $curCorr = trim((string) ($settings['benchRegisters']['corrLkgHex'] ?? ''));
    if ($curCorr === '' && $supplier !== '') {
        $settings['benchRegisters']['corrLkgHex'] = $supplier;
    }
    return $settings;
}

function admin_load_default_settings(): array
{
    global $defaultsPath;
    $json = file_get_contents($defaultsPath);
    if ($json === false) {
        throw new RuntimeException('Не найден config/defaults/device_settings.json');
    }
    $data = json_decode($json, true);
    if (!is_array($data)) {
        throw new RuntimeException('Некорректный JSON по умолчанию');
    }
    return $data;
}

function admin_load_stored_settings(): array
{
    global $storagePath;
    if (!is_readable($storagePath)) {
        return admin_load_default_settings();
    }
    $json = file_get_contents($storagePath);
    $data = json_decode((string) $json, true);
    return is_array($data) ? $data : admin_load_default_settings();
}

function admin_merge_recursive_distinct(array $defaults, array $overrides): array
{
    foreach ($overrides as $k => $v) {
        if (is_array($v) && isset($defaults[$k]) && is_array($defaults[$k])) {
            $defaults[$k] = admin_merge_recursive_distinct($defaults[$k], $v);
        } else {
            $defaults[$k] = $v;
        }
    }
    return $defaults;
}

/** Только параметры подключения приборов — без лишних полей для анонимного клиента. */
function admin_public_settings(array $merged): array
{
    $allowed = ['version', 'usb', 'mit', 'm90', 'tm07', 'pkd160', 'benchRegisters', 'benchScenarioDefaults'];
    $out = [];
    foreach ($allowed as $key) {
        if (array_key_exists($key, $merged)) {
            $out[$key] = $merged[$key];
        }
    }
    return admin_redact_device_secrets($out);
}

/**
 * Убрать ключи ЛКГ / пароли замков из анонимного ответа.
 *
 * @param array<string, mixed> $settings
 * @return array<string, mixed>
 */
function admin_redact_device_secrets(array $settings): array
{
    if (isset($settings['tm07']) && is_array($settings['tm07'])) {
        unset(
            $settings['tm07']['supplierLkgHex'],
            $settings['tm07']['manufacturerLkgHex'],
            $settings['tm07']['supplierLockPassword'],
            $settings['tm07']['manufacturerLockPassword']
        );
    }
    if (isset($settings['benchRegisters']) && is_array($settings['benchRegisters'])) {
        unset($settings['benchRegisters']['corrLkgHex']);
    }
    return $settings;
}

/**
 * Merge per-workstation USB overrides from CONFIG_JSON.deviceUsb.
 *
 * @param array<string,mixed> $settings
 * @return array<string,mixed>
 */
function admin_merge_workstation_usb(array $settings): array
{
    $fp = trim((string) ($_SERVER['HTTP_X_WORKSTATION_FINGERPRINT'] ?? ''));
    $code = trim((string) ($_SERVER['HTTP_X_WORKSTATION_CODE'] ?? ''));
    if ($fp === '' && $code === '') {
        return $settings;
    }
    try {
        require_once __DIR__ . '/bench_context.php';
        $pdo = bench_pdo();
        $usb = bench_workstation_device_usb($pdo, $fp !== '' ? $fp : null, $code !== '' ? $code : null);
        if ($usb === null || $usb === []) {
            return $settings;
        }

        return bench_apply_device_usb_to_settings($settings, $usb);
    } catch (Throwable) {
        return $settings;
    }
}

$action = $_GET['action'] ?? 'get';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($action === 'public') {
        $stored = admin_load_stored_settings();
        $defaults = admin_load_default_settings();
        $merged = admin_merge_workstation_usb(admin_merge_recursive_distinct($defaults, $stored));
        echo json_encode(['success' => true, 'settings' => admin_public_settings($merged)], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // Ключи ЛКГ / пароли замков — только для сессии оператора стенда.
    if ($action === 'bench' && $method === 'GET') {
        require_once __DIR__ . '/bench_context.php';
        try {
            bench_require_operator_session();
        } catch (RuntimeException $e) {
            http_response_code(403);
            echo json_encode(['success' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $stored = admin_load_stored_settings();
        $defaults = admin_load_default_settings();
        $merged = admin_merge_workstation_usb(
            admin_apply_env_lkg_overrides(admin_merge_recursive_distinct($defaults, $stored))
        );
        $allowed = ['version', 'usb', 'mit', 'm90', 'tm07', 'pkd160', 'benchRegisters', 'benchScenarioDefaults'];
        $out = [];
        foreach ($allowed as $key) {
            if (array_key_exists($key, $merged)) {
                $out[$key] = $merged[$key];
            }
        }
        echo json_encode(['success' => true, 'settings' => $out], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'get' && $method === 'GET') {
        auth_require_admin_role(AUTH_ROLE_CONFIG);
        $stored = admin_load_stored_settings();
        $defaults = admin_load_default_settings();
        $merged = admin_apply_env_lkg_overrides(admin_merge_recursive_distinct($defaults, $stored));
        echo json_encode([
            'success' => true,
            'settings' => $merged,
            'hasCustomFile' => is_readable($storagePath),
            'lkgFromEnv' => [
                'supplier' => admin_env_string('TM07_SUPPLIER_LKG_HEX') !== '' || admin_env_string('TM07_CORR_LKG_HEX') !== '',
                'manufacturer' => admin_env_string('TM07_MANUFACTURER_LKG_HEX') !== '',
            ],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'save' && $method === 'POST') {
        auth_require_admin_role(AUTH_ROLE_CONFIG);
        $raw = file_get_contents('php://input');
        $incoming = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($incoming) || !isset($incoming['settings']) || !is_array($incoming['settings'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Ожидается JSON { "settings": { ... } }'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $defaults = admin_load_default_settings();
        $merged = admin_merge_recursive_distinct($defaults, $incoming['settings']);
        $merged['version'] = (int) ($merged['version'] ?? 1);
        $encoded = json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        if ($encoded === false) {
            throw new RuntimeException('json_encode failed');
        }
        if (file_put_contents($storagePath, $encoded) === false) {
            throw new RuntimeException('Не удалось записать device_settings.json');
        }
        echo json_encode(['success' => true, 'message' => 'Настройки сохранены'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'reset' && $method === 'POST') {
        auth_require_admin_role(AUTH_ROLE_CONFIG);
        if (is_file($storagePath)) {
            unlink($storagePath);
        }
        echo json_encode(['success' => true, 'message' => 'Сброшено к встроенным умолчаниям'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Неверный запрос'], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => DEBUG ? $e->getMessage() : 'Ошибка сервера'], JSON_UNESCAPED_UNICODE);
}
