<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/passport_docx.php';
require_once __DIR__ . '/bench_context.php';

header('Content-Type: application/json; charset=utf-8');

function passport_json(array $payload, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function passport_read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || trim($raw) === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function passport_safe_download_name(string $name): string
{
    $name = basename(str_replace(['\\', '/'], '', $name));
    if (!str_ends_with(strtolower($name), '.docx')) {
        $name .= '.docx';
    }
    $base = preg_replace('/\.docx$/i', '', $name) ?? 'passport';
    return passport_sanitize_filename($base) . '.docx';
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($method === 'GET' && isset($_GET['download'])) {
        try {
            bench_require_operator_session();
        } catch (RuntimeException $e) {
            passport_json(['ok' => false, 'error' => $e->getMessage()], 403);
        }
        $filename = passport_safe_download_name((string) $_GET['download']);
        $path = passport_generated_dir() . '/' . $filename;
        if (!is_readable($path)) {
            passport_json(['ok' => false, 'error' => 'Файл не найден'], 404);
        }

        header('Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        header(
            "Content-Disposition: attachment; filename=\"passport.docx\"; filename*=UTF-8''" .
            rawurlencode($filename)
        );
        header('Content-Length: ' . (string) filesize($path));
        readfile($path);
        exit;
    }

    if ($method !== 'POST') {
        passport_json(['ok' => false, 'error' => 'GET ?download=… или POST JSON'], 405);
    }

    try {
        bench_require_operator_session();
    } catch (RuntimeException $e) {
        passport_json(['ok' => false, 'error' => $e->getMessage()], 403);
    }

    $body = passport_read_json_body();
    $kind = strtolower(trim((string) ($body['kind'] ?? 'auto')));

    if ($kind === 'auto') {
        $generated = passport_generate_auto($body);
    } else {
        $generated = [passport_generate_file($kind, $body)];
    }

    $files = [];
    foreach ($generated as $item) {
        $metaPath = $item['path'] . '.json';
        $meta = [
            'kind' => $item['kind'],
            'filename' => $item['filename'],
            'generatedAt' => gmdate('c'),
            'orderNumber' => $body['orderNumber'] ?? null,
            'correctorSerial' => $body['correctorSerial'] ?? null,
            'complexSerial' => $body['complexSerial'] ?? null,
        ];
        file_put_contents($metaPath, json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

        $files[] = [
            'kind' => $item['kind'],
            'filename' => $item['filename'],
            'url' => '/api/passport-generate.php?download=' . rawurlencode($item['filename']),
        ];
    }

    passport_json([
        'ok' => true,
        'files' => $files,
    ]);
} catch (InvalidArgumentException $e) {
    passport_json(['ok' => false, 'error' => $e->getMessage()], 400);
} catch (Throwable $e) {
    passport_json(['ok' => false, 'error' => $e->getMessage()], 500);
}
