<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/nameplate_print.php';
require_once __DIR__ . '/bench_context.php';

function nameplate_json(array $payload, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function nameplate_read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || trim($raw) === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function nameplate_serve_pdf_bytes(string $bytes, string $filename, bool $inline): never
{
    header('Content-Type: application/pdf');
    header('Content-Length: ' . (string) strlen($bytes));
    $disposition = $inline ? 'inline' : 'attachment';
    header('Content-Disposition: ' . $disposition . '; filename="' . $filename . '"');
    echo $bytes;
    exit;
}

function nameplate_download_generated(string $filename, bool $inline = false): never
{
    $safe = nameplate_safe_generated_file($filename);
    $path = nameplate_generated_dir() . '/' . $safe;
    if (!is_readable($path)) {
        nameplate_json(['ok' => false, 'error' => 'Файл не найден'], 404);
    }

    if (str_ends_with(strtolower($safe), '.pdf')) {
        $bytes = file_get_contents($path);
        if ($bytes === false) {
            nameplate_json(['ok' => false, 'error' => 'Не удалось прочитать PDF'], 500);
        }
        nameplate_serve_pdf_bytes($bytes, $safe, $inline);
    }

    $mime = 'application/octet-stream';
    if (str_ends_with(strtolower($safe), '.json')) {
        $mime = 'application/json; charset=utf-8';
    } elseif (str_ends_with(strtolower($safe), '.btxml')) {
        $mime = 'application/xml; charset=utf-8';
    } elseif (str_ends_with(strtolower($safe), '.png')) {
        $mime = 'image/png';
    }

    $disposition = ($inline && str_ends_with(strtolower($safe), '.png')) ? 'inline' : 'attachment';
    header('Content-Type: ' . $mime);
    header('Content-Disposition: ' . $disposition . '; filename="' . $safe . '"');
    header('Content-Length: ' . (string) filesize($path));
    readfile($path);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string) ($_GET['action'] ?? '');

try {
    if ($method === 'GET' && $action === 'config') {
        nameplate_json([
            'ok' => true,
            'config' => nameplate_public_config(),
        ]);
    }

    if ($method === 'POST' && $action === 'save-config') {
        try {
            bench_require_operator_session();
        } catch (RuntimeException $e) {
            nameplate_json(['ok' => false, 'error' => $e->getMessage()], 403);
        }
        $input = nameplate_read_json_body();
        $patch = is_array($input['printAgent'] ?? null) ? $input['printAgent'] : $input;
        try {
            $saved = nameplate_save_print_agent_settings(is_array($patch) ? $patch : []);
            nameplate_json([
                'ok' => true,
                'config' => nameplate_public_config(),
                'printAgent' => $saved['printAgent'],
            ]);
        } catch (Throwable $e) {
            nameplate_json(['ok' => false, 'error' => $e->getMessage()], 500);
        }
    }

    if ($method === 'GET' && $action === 'health') {
        $templatePath = nameplate_template_file('corrector');
        nameplate_json([
            'ok' => true,
            'engine' => nameplate_engine(nameplate_load_config()),
            'template' => basename($templatePath),
            'templateExists' => is_readable($templatePath),
            'generatedDir' => nameplate_generated_dir(),
            'pdfReady' => is_readable(dirname(__DIR__) . '/vendor/autoload.php'),
        ]);
    }

    if ($method === 'GET' && ($action === 'download' || $action === 'preview')) {
        try {
            bench_require_operator_session();
        } catch (RuntimeException $e) {
            nameplate_json(['ok' => false, 'error' => $e->getMessage()], 403);
        }

        $file = trim((string) ($_GET['file'] ?? ''));
        if ($file !== '') {
            nameplate_download_generated($file, $action === 'preview');
        }

        if ($action === 'preview') {
            $serial = trim((string) ($_GET['serial'] ?? ''));
            if ($serial !== '') {
                $input = $_GET;
                $payload = [
                    'kind' => strtolower(trim((string) ($input['kind'] ?? 'corrector'))),
                    'serial' => $serial,
                    'orderNumber' => trim((string) ($input['orderNumber'] ?? '')),
                    'productTitle' => trim((string) ($input['productTitle'] ?? '')),
                    'manufactureDate' => trim((string) ($input['manufactureDate'] ?? '')),
                    'organizationName' => trim((string) ($input['organizationName'] ?? '')),
                    'configText' => trim((string) ($input['configText'] ?? '')),
                    'orderConfig' => trim((string) ($input['orderConfig'] ?? '')),
                ];
                $context = nameplate_build_context($payload);
                $bytes = nameplate_render_pdf_bytes($context);
                $filename = nameplate_pdf_filename($context['serial'], $context['kind']);
                nameplate_serve_pdf_bytes($bytes, $filename, true);
            }
            nameplate_json(['ok' => false, 'error' => 'Укажите параметр file или serial для preview'], 400);
        }

        nameplate_json(['ok' => false, 'error' => 'Укажите параметр file'], 400);
    }

    try {
        bench_require_operator_session();
    } catch (RuntimeException $e) {
        if ($method === 'GET') {
            nameplate_json(['ok' => false, 'error' => $e->getMessage()], 403);
        }
        nameplate_json(['ok' => false, 'error' => $e->getMessage()], 403);
    }

    if ($method === 'POST' && $action === 'print-direct') {
        $input = nameplate_read_json_body();
        $serial = trim((string) ($input['serial'] ?? ''));
        if ($serial === '') {
            nameplate_json(['ok' => false, 'error' => 'serial обязателен'], 400);
        }
        $payload = [
            'kind' => strtolower(trim((string) ($input['kind'] ?? 'corrector'))),
            'serial' => $serial,
            'orderNumber' => trim((string) ($input['orderNumber'] ?? '')),
            'productTitle' => trim((string) ($input['productTitle'] ?? '')),
            'manufactureDate' => trim((string) ($input['manufactureDate'] ?? '')),
            'organizationName' => trim((string) ($input['organizationName'] ?? '')),
            'configText' => trim((string) ($input['configText'] ?? '')),
            'orderConfig' => trim((string) ($input['orderConfig'] ?? '')),
        ];
        require_once __DIR__ . '/lib/nameplate_tspl.php';
        try {
            $config = nameplate_load_config();
            $bytes = nameplate_render_tspl_bytes($payload, $config, null);
        } catch (Throwable $e) {
            nameplate_json(['ok' => false, 'error' => 'Не удалось собрать TSPL: ' . $e->getMessage()], 500);
        }
        nameplate_json(nameplate_tspl_send_direct($bytes, nameplate_load_config()));
    }

    if ($method === 'POST' && $action === 'save-filled') {
        $input = nameplate_read_json_body();
        $filename = trim((string) ($input['filename'] ?? ''));
        $dataBase64 = trim((string) ($input['dataBase64'] ?? ''));
        if ($filename === '' || $dataBase64 === '') {
            nameplate_json(['ok' => false, 'error' => 'filename и dataBase64 обязательны'], 400);
        }
        $bytes = base64_decode($dataBase64, true);
        if ($bytes === false) {
            nameplate_json(['ok' => false, 'error' => 'Некорректный dataBase64'], 400);
        }
        $stored = nameplate_store_filled_btw($filename, $bytes);
        nameplate_json(['ok' => true, 'generated' => $stored]);
    }

    $input = $method === 'POST' ? nameplate_read_json_body() : $_GET;
    $kind = strtolower(trim((string) ($input['kind'] ?? 'corrector')));
    $serial = trim((string) ($input['serial'] ?? ''));

    $payload = [
        'kind' => $kind,
        'serial' => $serial,
        'orderNumber' => trim((string) ($input['orderNumber'] ?? '')),
        'productTitle' => trim((string) ($input['productTitle'] ?? '')),
        'manufactureDate' => trim((string) ($input['manufactureDate'] ?? '')),
        'organizationName' => trim((string) ($input['organizationName'] ?? '')),
        'configText' => trim((string) ($input['configText'] ?? '')),
        'orderConfig' => trim((string) ($input['orderConfig'] ?? '')),
    ];

    $job = nameplate_build_print_job($payload);
    $context = nameplate_build_context($payload);

    if ($method === 'POST') {
        try {
            $pdo = bench_pdo();
            bench_log_event($pdo, [
                'eventType' => 'nameplate_generate_pdf',
                'stage' => 'assembly',
                'serialCorrector' => $context['kind'] === 'corrector' ? $serial : null,
                'serialComplex' => $context['kind'] === 'complex' ? $serial : null,
                'payload' => [
                    'kind' => $context['kind'],
                    'serial' => $serial,
                    'orderNumber' => $context['orderNumber'],
                    'engine' => $job['engine'],
                    'filename' => $job['filename'] ?? ($job['generated']['filename'] ?? null),
                ],
            ]);
        } catch (Throwable $logErr) {
            error_log('nameplate_generate_pdf log: ' . $logErr->getMessage());
        }

        $filled = (bool) (($job['generated']['filled'] ?? false) || ($job['filled'] ?? false) || ($job['engine'] ?? '') === 'pdf' || ($job['engine'] ?? '') === 'html');
        $engine = (string) ($job['engine'] ?? '');
        if ($engine === 'pdf' || $engine === 'html') {
            $userMessage = 'Label will be sent to the print agent (TSPL/PNG).';
        } elseif ($engine === 'bartender' || $engine === 'btw') {
            $userMessage = 'Label will be sent to the Windows print agent (.btw).';
        } elseif ($filled) {
            $userMessage = 'Template file with field values prepared.';
        } else {
            $userMessage = 'Template copy without filled fields — start the Windows agent.';
        }

        nameplate_json(array_merge([
            'ok' => true,
            'kind' => $context['kind'],
            'serial' => $serial,
            'engine' => $job['engine'],
            'template' => $job['template'],
            'templatePath' => $job['templatePath'],
            'filled' => $filled,
            'userMessage' => $userMessage,
        ], array_filter([
            'generated' => $job['generated'] ?? null,
            'downloadUrl' => $job['downloadUrl'] ?? ($job['generated']['downloadUrl'] ?? null),
            'previewUrl' => $job['previewUrl'] ?? ($job['generated']['previewUrl'] ?? null),
            'pngDownloadUrl' => $job['pngDownloadUrl'] ?? ($job['generated']['pngDownloadUrl'] ?? null),
            'filename' => $job['filename'] ?? ($job['generated']['filename'] ?? null),
            'mime' => $job['mime'] ?? null,
            'fields' => $job['fields'] ?? null,
            'agentUrl' => $job['agentUrl'] ?? null,
            'printAgentUrl' => $job['printAgentUrl'] ?? null,
            'printAgentToken' => $job['printAgentToken'] ?? null,
            'printFormat' => $job['printFormat'] ?? null,
            'tspl' => $job['tspl'] ?? null,
            'tsplDownloadUrl' => $job['tsplDownloadUrl'] ?? null,
            'printer' => $job['printer'] ?? null,
            'btxml' => $job['btxml'] ?? null,
            'htmlFallback' => $job['htmlFallback'] ?? null,
            'html' => $job['html'] ?? null,
        ], static fn ($v) => $v !== null)));
    }

    if (($job['engine'] ?? '') === 'pdf' || ($job['engine'] ?? '') === 'raster') {
        if (($job['engine'] ?? '') === 'raster' && !empty($job['previewUrl'])) {
            nameplate_json(array_merge([
                'ok' => true,
                'kind' => $context['kind'],
                'serial' => $serial,
                'engine' => 'raster',
                'filled' => true,
            ], array_filter([
                'downloadUrl' => $job['downloadUrl'] ?? null,
                'previewUrl' => $job['previewUrl'] ?? null,
                'pngDownloadUrl' => $job['pngDownloadUrl'] ?? null,
                'tsplDownloadUrl' => $job['tsplDownloadUrl'] ?? null,
                'filename' => $job['filename'] ?? null,
            ], static fn ($v) => $v !== null)));
        }
        $bytes = nameplate_render_pdf($payload);
        $filename = nameplate_pdf_filename($context['serial'], $context['kind']);
        nameplate_serve_pdf_bytes($bytes, $filename, true);
    }

    if (($job['engine'] ?? '') === 'btw' && isset($job['generated']['downloadUrl'])) {
        nameplate_json([
            'ok' => true,
            'engine' => 'btw',
            'serial' => $serial,
            'filled' => (bool) ($job['generated']['filled'] ?? false),
            'downloadUrl' => $job['generated']['downloadUrl'],
            'filename' => $job['generated']['filename'],
        ]);
    }

    if (!empty($job['html'])) {
        header('Content-Type: text/html; charset=utf-8');
        echo $job['html'];
        exit;
    }

    nameplate_json(['ok' => false, 'error' => 'Требуется POST для печати шильдика'], 400);
} catch (InvalidArgumentException $e) {
    nameplate_json(['ok' => false, 'error' => $e->getMessage()], 400);
} catch (Throwable $e) {
    nameplate_json(['ok' => false, 'error' => 'Ошибка печати шильдика: ' . $e->getMessage()], 500);
}
