<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/btw_parser.php';
require_once __DIR__ . '/auth_common.php';

function btw_json(array $payload, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string) ($_GET['action'] ?? '');

try {
    // Шаблоны шильдиков — только админ или сессия оператора.
    if (!auth_is_admin()) {
        require_once __DIR__ . '/bench_context.php';
        try {
            bench_require_operator_session();
        } catch (RuntimeException $e) {
            btw_json(['ok' => false, 'error' => $e->getMessage()], 403);
        }
    }

    if ($method === 'GET' && $action === 'list') {
        $dir = btw_templates_dir();
        $items = [];
        foreach (btw_list_template_files() as $name) {
            $info = btw_template_info($name);
            $items[] = [
                'name' => $info['name'],
                'size' => $info['size'],
                'modified' => $info['modified'],
                'modifiedIso' => $info['modified'] > 0
                    ? gmdate('c', $info['modified'])
                    : null,
            ];
        }

        btw_json([
            'ok' => true,
            'directory' => $dir,
            'files' => $items,
            'knownFields' => btw_known_field_names(),
        ]);
    }

    if ($method === 'GET' && $action === 'label') {
        $file = (string) ($_GET['file'] ?? '');
        if ($file === '') {
            btw_json(['ok' => false, 'error' => 'Укажите параметр file'], 400);
        }

        $info = btw_template_info($file);
        $labelSpec = btw_extract_label_spec_file($info['path']);
        btw_json([
            'ok' => true,
            'file' => $info['name'],
            'labelSpec' => $labelSpec,
        ]);
    }

    if ($method === 'GET' && $action === 'parse') {
        $file = (string) ($_GET['file'] ?? '');
        if ($file === '') {
            btw_json(['ok' => false, 'error' => 'Укажите параметр file'], 400);
        }

        $info = btw_template_info($file);
        $parsed = btw_parse_file($info['path'], $info['name']);
        $parsed['file'] = [
            'name' => $info['name'],
            'size' => $info['size'],
            'modified' => $info['modified'],
        ];
        $parsed['knownFields'] = btw_known_field_names();

        btw_json(['ok' => true, 'result' => $parsed]);
    }

    if ($method === 'POST' && $action === 'upload') {
        if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
            btw_json(['ok' => false, 'error' => 'Файл не передан (поле file)'], 400);
        }

        $upload = $_FILES['file'];
        $error = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($error !== UPLOAD_ERR_OK) {
            btw_json(['ok' => false, 'error' => 'Ошибка загрузки: ' . $error], 400);
        }

        $tmp = (string) ($upload['tmp_name'] ?? '');
        $orig = (string) ($upload['name'] ?? 'upload.btw');
        $size = (int) ($upload['size'] ?? 0);

        if ($size <= 0 || $size > 15 * 1024 * 1024) {
            btw_json(['ok' => false, 'error' => 'Размер файла должен быть от 1 байта до 15 МБ'], 400);
        }

        btw_safe_basename($orig);

        $data = file_get_contents($tmp);
        if ($data === false) {
            btw_json(['ok' => false, 'error' => 'Не удалось прочитать загруженный файл'], 500);
        }

        $parsed = btw_parse_bytes($data, basename($orig));
        $parsed['file'] = [
            'name' => basename($orig),
            'size' => $size,
            'modified' => null,
        ];
        $parsed['knownFields'] = btw_known_field_names();

        btw_json(['ok' => true, 'result' => $parsed]);
    }

    btw_json(['ok' => false, 'error' => 'Неизвестное действие'], 404);
} catch (InvalidArgumentException $e) {
    btw_json(['ok' => false, 'error' => $e->getMessage()], 400);
} catch (RuntimeException $e) {
    btw_json(['ok' => false, 'error' => $e->getMessage()], 404);
} catch (Throwable $e) {
    btw_json(['ok' => false, 'error' => 'Внутренняя ошибка'], 500);
}
