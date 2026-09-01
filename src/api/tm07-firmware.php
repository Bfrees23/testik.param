<?php
declare(strict_types=1);

/**
 * Список и выдача .bin прошивок ТМ-07 из папки (CorrReader: TM-07_*_v1.010105_*.bin).
 */
require_once __DIR__ . '/auth_common.php';

header('X-Content-Type-Options: nosniff');

function tm07_firmware_dirs(): array
{
    $dirs = [];
    $env = trim((string) (getenv('TM07_FIRMWARE_DIR') ?: ''));
    if ($env !== '') {
        $dirs[] = $env;
    }
    $dirs[] = dirname(BASE_PATH) . '/firmware';
    $dirs[] = BASE_PATH . '/firmware';
    $dirs[] = auth_data_dir() . '/firmware';
    $out = [];
    foreach ($dirs as $d) {
        $real = realpath($d);
        if ($real && is_dir($real) && !in_array($real, $out, true)) {
            $out[] = $real;
        }
    }
    return $out;
}

/**
 * Из имени TM-07_230176_v1.010105_2A23F66C_438D4EAA.bin берём только v1.010105.
 */
function tm07_firmware_parse_version(string $name): string
{
    if (preg_match('/(?:^|[_\-.])v(\d+\.\d+)/i', $name, $m)) {
        return $m[1];
    }
    if (preg_match('/\bv(\d+\.\d+)/i', $name, $m)) {
        return $m[1];
    }
    return '';
}

function tm07_firmware_norm_version(string $ver): string
{
    $ver = trim($ver);
    $ver = (string) preg_replace('/^v/i', '', $ver);
    if (preg_match('/(\d+\.\d+)/', $ver, $m)) {
        return $m[1];
    }
    return $ver;
}

function tm07_firmware_safe_name(string $name): string
{
    $base = basename(str_replace('\\', '/', $name));
    if (!preg_match('/^[A-Za-z0-9._\-]+(?:\.bin)?$/i', $base)) {
        throw new InvalidArgumentException('Недопустимое имя файла прошивки');
    }
    return $base;
}

function tm07_firmware_find(string $name): string
{
    $raw = trim($name);
    $byVer = tm07_firmware_norm_version($raw);
    if ($byVer !== '') {
        foreach (tm07_firmware_list() as $f) {
            if (($f['version'] ?? '') === $byVer && !empty($f['path']) && is_file($f['path'])) {
                return (string) $f['path'];
            }
        }
    }
    $base = tm07_firmware_safe_name($raw);
    foreach (tm07_firmware_dirs() as $dir) {
        $path = $dir . DIRECTORY_SEPARATOR . $base;
        $real = realpath($path);
        if ($real && is_file($real) && str_starts_with($real, $dir)) {
            return $real;
        }
    }
    throw new RuntimeException($byVer !== '' ? ('Прошивка v' . $byVer . ' не найдена в папке') : ('Файл прошивки не найден: ' . $base));
}

function tm07_firmware_list(): array
{
    $seen = [];
    $files = [];
    foreach (tm07_firmware_dirs() as $dir) {
        $list = array_merge(
            glob($dir . DIRECTORY_SEPARATOR . '*.bin') ?: [],
            glob($dir . DIRECTORY_SEPARATOR . 'TM-07*') ?: []
        );
        foreach ($list as $path) {
            $name = basename($path);
            if (isset($seen[$name])) {
                continue;
            }
            $seen[$name] = true;
            $ver = tm07_firmware_parse_version($name);
            $lkgHex = '';
            if (preg_match('/v\d+\.\d+_([0-9A-Fa-f]{8}(?:_[0-9A-Fa-f]{8})*)/i', $name, $lm)) {
                $lkgHex = strtoupper($lm[1]);
            }
            $files[] = [
                'name' => $name,
                'version' => $ver,
                'versionTag' => $ver !== '' ? ('v' . $ver) : '',
                'lkgHex' => $lkgHex,
                'size' => filesize($path) ?: 0,
                'mtime' => filemtime($path) ?: 0,
                'dir' => $dir,
                'path' => $path,
            ];
        }
    }
    usort($files, static function ($a, $b) {
        return ($b['mtime'] <=> $a['mtime']);
    });
    return $files;
}

$action = (string) ($_GET['action'] ?? 'list');

try {
    if ($action === 'list') {
        header('Content-Type: application/json; charset=utf-8');
        $dirs = tm07_firmware_dirs();
        echo json_encode([
            'ok' => true,
            'dirs' => $dirs,
            'files' => array_map(static function ($f) {
                unset($f['dir'], $f['path']);
                return $f;
            }, tm07_firmware_list()),
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'file') {
        $name = (string) ($_GET['name'] ?? '');
        $path = tm07_firmware_find($name);
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . basename($path) . '"');
        header('Content-Length: ' . (string) filesize($path));
        readfile($path);
        exit;
    }

    header('Content-Type: application/json; charset=utf-8');
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'action: list | file'], JSON_UNESCAPED_UNICODE);
} catch (InvalidArgumentException $e) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    header('Content-Type: application/json; charset=utf-8');
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
