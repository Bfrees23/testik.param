<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/nameplate_print.php';
require_once __DIR__ . '/lib/nameplate_template_editor.php';
require_once __DIR__ . '/bench_context.php';

function nameplate_template_json(array $payload, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function nameplate_template_read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if (!is_string($raw) || trim($raw) === '') {
        return [];
    }
    $data = json_decode($raw, true);

    return is_array($data) ? $data : [];
}

/** @param array<string, mixed> $document */
function nameplate_template_client_document(array $document): array
{
    $document = nameplate_editor_normalize_document($document);
    if (($document['dynamicFields'] ?? null) === []) {
        $document['dynamicFields'] = new stdClass();
    }

    return $document;
}

function nameplate_template_id_from_request(): string
{
    $id = trim((string) ($_GET['templateId'] ?? $_POST['templateId'] ?? $_GET['kind'] ?? $_POST['kind'] ?? 'corrector'));

    return nameplate_template_id_key($id !== '' ? $id : 'corrector');
}

function nameplate_template_kind_from_request(): string
{
    return nameplate_template_kind_key(nameplate_template_id_from_request());
}

function nameplate_template_preview_image_raw_path(): ?string
{
    $candidates = [
        nameplate_templates_dir() . '/extracted/png1.png',
        nameplate_templates_dir() . '/corrector-nameplate-static.png',
    ];
    foreach ($candidates as $path) {
        if (is_readable($path)) {
            return $path;
        }
    }

    require_once __DIR__ . '/lib/btw_parser.php';
    $btwPath = nameplate_templates_dir() . '/corrector-300.btw';
    if (!is_readable($btwPath)) {
        return null;
    }
    $parsed = btw_parse_file($btwPath, 'corrector-300.btw');
    $dataUrl = (string) ($parsed['embeddedImages'][0]['dataUrl'] ?? '');
    if ($dataUrl === '' || !str_contains($dataUrl, ',')) {
        return null;
    }
    $png = base64_decode(substr($dataUrl, strpos($dataUrl, ',') + 1), true);
    if (!is_string($png) || $png === '') {
        return null;
    }
    $dest = nameplate_templates_dir() . '/extracted/png1.png';
    $dir = dirname($dest);
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        return null;
    }
    file_put_contents($dest, $png);

    return is_readable($dest) ? $dest : null;
}

/** @param array<string, mixed>|null $document */
function nameplate_template_preview_image_path(string $templateId, ?array $document = null): ?string
{
    if ($document === null) {
        try {
            $document = nameplate_load_fields_document($templateId);
        } catch (Throwable) {
            $document = [];
        }
    }

    $raw = nameplate_template_preview_image_raw_path();
    if ($raw === null) {
        return null;
    }

    $refW = max(100, (int) ($document['refW'] ?? 1052));
    $refH = max(100, (int) ($document['refH'] ?? 364));
    $info = @getimagesize($raw);
    if (is_array($info) && (int) $info[0] === $refW && (int) $info[1] === $refH) {
        return $raw;
    }

    if (!class_exists('Imagick')) {
        return $raw;
    }

    $cacheDir = nameplate_templates_dir() . '/extracted';
    $cacheKey = md5($raw . '|' . (string) filemtime($raw) . '|' . $refW . 'x' . $refH);
    $cache = $cacheDir . '/label-bg-' . $cacheKey . '.png';
    if (is_readable($cache)) {
        return $cache;
    }

    $im = new Imagick($raw);
    $im->setImageType(Imagick::IMGTYPE_TRUECOLOR);
    $im->setImageAlphaChannel(Imagick::ALPHACHANNEL_DEACTIVATE);

    // BarTender embed is often square (1052?1052); trim to the label band before scaling.
    if ($im->getImageHeight() > (int) round($refH * 1.15) || $im->getImageWidth() !== $refW) {
        $im->trimImage(0);
    }

    if ($im->getImageWidth() !== $refW || $im->getImageHeight() !== $refH) {
        $im->resizeImage($refW, $refH, Imagick::FILTER_LANCZOS, 1, false);
    }

    if (!is_dir($cacheDir) && !mkdir($cacheDir, 0775, true) && !is_dir($cacheDir)) {
        return $raw;
    }
    $im->writeImage($cache);
    $im->clear();
    $im->destroy();

    return is_readable($cache) ? $cache : $raw;
}

function nameplate_template_require_operator(): void
{
    try {
        bench_require_operator_session();
    } catch (RuntimeException $e) {
        nameplate_template_json(['ok' => false, 'error' => $e->getMessage()], 403);
    }
}

function nameplate_template_serve_preview_image(string $templateId, array $document): never
{
    $path = nameplate_template_preview_image_path($templateId, $document);
    if ($path === null) {
        nameplate_template_json(['ok' => false, 'error' => 'Фоновое изображение шаблона не найдено'], 404);
    }

    $mime = str_ends_with(strtolower($path), '.png') ? 'image/png' : 'image/jpeg';
    header('Content-Type: ' . $mime);
    header('Cache-Control: no-store');
    header('Content-Length: ' . (string) filesize($path));
    readfile($path);
    exit;
}

function nameplate_template_serve_preview_pdf(array $payload, ?array $fields): never
{
    $context = nameplate_build_preview_context($payload);
    $bytes = nameplate_render_pdf_bytes($context, null, $fields);
    $filename = nameplate_pdf_filename($context['serial'], $context['kind']);
    header('Content-Type: application/pdf');
    header('Content-Length: ' . (string) strlen($bytes));
    header('Content-Disposition: inline; filename="' . $filename . '"');
    echo $bytes;
    exit;
}

/**
 * @param array<string, mixed>|null $fields
 */
function nameplate_template_serve_preview_png(array $payload, ?array $fields, bool $thermal, bool $download = false): never
{
    require_once __DIR__ . '/lib/nameplate_tspl.php';
    $context = nameplate_build_preview_context($payload);
    $pdf = nameplate_render_pdf_bytes($context, null, $fields);
    $config = nameplate_load_config();
    $widthMm = (float) ($fields['pageWidthMm'] ?? $context['pageWidthMm'] ?? 58);
    $heightMm = (float) ($fields['pageHeightMm'] ?? $context['pageHeightMm'] ?? 20);
    if (is_array($fields)) {
        $widthMm = (float) ($fields['pageWidthMm'] ?? $widthMm);
        $heightMm = (float) ($fields['pageHeightMm'] ?? $heightMm);
    }
    $png = $thermal
        ? nameplate_pdf_bytes_to_thermal_png($pdf, $widthMm, $heightMm, $config)
        : nameplate_pdf_bytes_to_png($pdf, $config);
    $filename = nameplate_pdf_filename($context['serial'], $context['kind']);
    $filename = preg_replace('/\.pdf$/i', $thermal ? '-thermal.png' : '.png', $filename) ?: ($context['serial'] . '.png');
    header('Content-Type: image/png');
    header('Content-Length: ' . (string) strlen($png));
    header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . $filename . '"');
    header('Cache-Control: no-store');
    echo $png;
    exit;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string) ($_GET['action'] ?? '');

try {
    if ($method === 'GET' && $action === 'reference-pdf') {
        nameplate_template_require_operator();
        require_once __DIR__ . '/lib/nameplate_reference_drawing.php';
        $path = nameplate_reference_drawing_pdf_path();
        if (!is_readable($path)) {
            nameplate_template_json(['ok' => false, 'error' => 'Файл чертежа не найден'], 404);
        }
        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="' . nameplate_reference_drawing_pdf_basename() . '"');
        header('Content-Length: ' . (string) filesize($path));
        readfile($path);
        exit;
    }

    if ($method === 'GET' && $action === 'reference-overlay') {
        nameplate_template_require_operator();
        $dir = dirname(__DIR__) . '/data/nameplate-templates';
        $candidates = [
            $dir . '/reference-overlay.png',
            $dir . '/_btw_preview_trimmed.png',
            $dir . '/corrector-nameplate-static.png',
        ];
        $path = null;
        foreach ($candidates as $candidate) {
            if (is_readable($candidate)) {
                $path = $candidate;
                break;
            }
        }
        if ($path === null) {
            // Build from .btw preview on demand
            require_once __DIR__ . '/lib/btw_parser.php';
            $btw = $dir . '/corrector-300.btw';
            if (is_readable($btw) && class_exists('Imagick')) {
                $data = file_get_contents($btw);
                $images = is_string($data) ? btw_extract_png_images($data) : [];
                if (isset($images[0]['dataUrl'])) {
                    $raw = base64_decode(substr((string) $images[0]['dataUrl'], strpos((string) $images[0]['dataUrl'], ',') + 1), true);
                    if (is_string($raw) && $raw !== '') {
                        $im = new Imagick();
                        $im->readImageBlob($raw);
                        $im->trimImage(0);
                        $im->setImagePage(0, 0, 0, 0);
                        $out = $dir . '/_btw_preview_trimmed.png';
                        $im->writeImage($out);
                        $im->clear();
                        $im->destroy();
                        if (is_readable($out)) {
                            $path = $out;
                        }
                    }
                }
            }
        }
        if ($path === null) {
            nameplate_template_json(['ok' => false, 'error' => 'Эталонный PNG не найден'], 404);
        }
        header('Content-Type: image/png');
        header('Cache-Control: no-store');
        header('Content-Length: ' . (string) filesize($path));
        readfile($path);
        exit;
    }

    if ($method === 'GET' && $action === 'preview-image') {
        $templateId = nameplate_template_id_from_request();
        $document = nameplate_load_fields_document($templateId);
        if (nameplate_template_is_blank_canvas($document)) {
            nameplate_template_json(['ok' => false, 'error' => 'Blank canvas has no background image'], 404);
        }
        nameplate_template_serve_preview_image($templateId, $document);
    }

    if ($method === 'GET' && $action === 'list') {
        nameplate_template_require_operator();
        nameplate_template_json([
            'ok' => true,
            'templates' => nameplate_list_field_templates(),
        ]);
    }

    if ($method === 'GET' && $action === 'load') {
        nameplate_template_require_operator();
        $templateId = nameplate_template_id_from_request();
        $document = nameplate_load_fields_document($templateId);
        $previewPath = nameplate_template_preview_image_path($templateId, $document);
        $btwFile = (string) ($document['referenceTemplate'] ?? 'corrector-300.btw');
        $printKind = nameplate_template_document_print_kind($document);
        $blankCanvas = nameplate_template_is_blank_canvas($document);

        nameplate_template_json([
            'ok' => true,
            'kind' => $printKind,
            'templateId' => $templateId,
            'document' => nameplate_template_client_document($document),
            'templates' => nameplate_list_field_templates(),
            'samplePayload' => nameplate_template_editor_sample_payload($printKind),
            'dataSources' => nameplate_editor_data_sources(),
            'staticObjects' => $blankCanvas ? [] : nameplate_editor_static_objects(),
            'previewImageUrl' => '/api/nameplate-template.php?action=preview-image&templateId=' . rawurlencode($templateId),
            'previewImageExists' => !$blankCanvas && $previewPath !== null,
            'blankCanvas' => $blankCanvas,
            'fieldsPath' => nameplate_fields_filename($templateId),
            'referenceBtw' => $btwFile,
            'pageSize' => [
                'widthMm' => (float) ($document['pageWidthMm'] ?? 58),
                'heightMm' => (float) ($document['pageHeightMm'] ?? 20),
            ],
        ]);
    }

    if ($method === 'POST' && $action === 'create') {
        nameplate_template_require_operator();
        $body = nameplate_template_read_json_body();
        $document = nameplate_create_new_fields_document($body);
        $templateId = (string) ($document['templateId'] ?? 'template');
        $saved = nameplate_save_fields_document($templateId, $document);
        nameplate_template_json([
            'ok' => true,
            'templateId' => $templateId,
            'document' => nameplate_template_client_document($document),
            'saved' => $saved,
            'templates' => nameplate_list_field_templates(),
        ]);
    }

    if ($method === 'POST' && $action === 'rename') {
        nameplate_template_require_operator();
        $body = nameplate_template_read_json_body();
        $rawId = trim((string) ($body['templateId'] ?? ''));
        if ($rawId === '') {
            nameplate_template_json(['ok' => false, 'error' => 'Укажите templateId'], 400);
        }
        $newName = trim((string) ($body['name'] ?? $body['templateName'] ?? ''));
        $newSlug = array_key_exists('slug', $body) ? trim((string) $body['slug']) : null;
        try {
            $result = nameplate_rename_fields_template($rawId, $newName, $newSlug);
            nameplate_template_json([
                'ok' => true,
                'templateId' => $result['templateId'],
                'document' => nameplate_template_client_document($result['document']),
                'renamedFile' => $result['renamedFile'],
                'templates' => $result['templates'],
            ]);
        } catch (Throwable $e) {
            nameplate_template_json(['ok' => false, 'error' => $e->getMessage()], 400);
        }
    }

    if ($method === 'POST' && $action === 'duplicate') {
        nameplate_template_require_operator();
        $body = nameplate_template_read_json_body();
        $rawId = trim((string) ($body['templateId'] ?? ''));
        if ($rawId === '') {
            nameplate_template_json(['ok' => false, 'error' => 'Укажите templateId'], 400);
        }
        try {
            $result = nameplate_duplicate_fields_template(
                $rawId,
                isset($body['name']) ? (string) $body['name'] : null,
                isset($body['slug']) ? (string) $body['slug'] : null
            );
            nameplate_template_json([
                'ok' => true,
                'templateId' => $result['templateId'],
                'document' => nameplate_template_client_document($result['document']),
                'saved' => $result['saved'],
                'templates' => $result['templates'],
            ]);
        } catch (Throwable $e) {
            nameplate_template_json(['ok' => false, 'error' => $e->getMessage()], 400);
        }
    }

    if ($method === 'POST' && $action === 'delete') {
        nameplate_template_require_operator();
        $body = nameplate_template_read_json_body();
        $rawId = trim((string) ($body['templateId'] ?? $_GET['templateId'] ?? ''));
        if ($rawId === '') {
            nameplate_template_json(['ok' => false, 'error' => 'Укажите templateId'], 400);
        }
        $templateId = nameplate_template_id_key($rawId);
        $deleted = nameplate_delete_fields_template($templateId);
        nameplate_template_json([
            'ok' => true,
            'deleted' => $deleted,
            'templates' => nameplate_list_field_templates(),
            'fallbackTemplateId' => 'corrector',
        ]);
    }

    if ($method === 'POST' && $action === 'save') {
        nameplate_template_require_operator();
        $body = nameplate_template_read_json_body();
        $templateId = nameplate_template_id_key((string) ($body['templateId'] ?? $body['kind'] ?? 'corrector'));
        $document = $body['document'] ?? null;
        if (!is_array($document)) {
            nameplate_template_json(['ok' => false, 'error' => 'Укажите document (JSON объекта полей)'], 400);
        }

        $saved = nameplate_save_fields_document($templateId, $document);
        nameplate_template_json([
            'ok' => true,
            'templateId' => $templateId,
            'kind' => nameplate_template_kind_key($templateId),
            'saved' => $saved,
            'templates' => nameplate_list_field_templates(),
        ]);
    }

    if ($method === 'POST' && $action === 'preview') {
        nameplate_template_require_operator();
        $body = nameplate_template_read_json_body();
        $payload = is_array($body['payload'] ?? null) ? $body['payload'] : nameplate_template_editor_sample_payload('corrector');
        $payload['kind'] = nameplate_template_print_kind((string) ($payload['kind'] ?? 'corrector'));
        $fields = is_array($body['document'] ?? null) ? $body['document'] : null;
        if ($fields !== null) {
            $fields = nameplate_editor_normalize_document($fields);
            nameplate_validate_fields_document($fields);
            if (!is_array($fields['editorObjects'] ?? null) || $fields['editorObjects'] === []) {
                $fields['editorObjects'] = [];
            }
        }
        $format = strtolower(trim((string) ($body['format'] ?? $_GET['format'] ?? 'pdf')));
        $download = !empty($body['download']) || ((string) ($_GET['download'] ?? '') === '1');
        if ($format === 'png' || $format === 'thermal' || $format === 'thermal-png') {
            nameplate_template_serve_preview_png($payload, $fields, $format !== 'png', $download);
        }
        nameplate_template_serve_preview_pdf($payload, $fields);
    }

    if ($method === 'GET' && $action === 'thumbnail') {
        nameplate_template_require_operator();
        require_once __DIR__ . '/lib/nameplate_tspl.php';
        $templateId = nameplate_template_id_from_request();
        $document = nameplate_load_fields_document($templateId);
        $kind = nameplate_template_document_print_kind($document);
        $payload = nameplate_template_editor_sample_payload($kind);
        $pdf = nameplate_render_pdf_bytes(nameplate_build_preview_context($payload), null, $document);
        $config = nameplate_load_config();
        $png = nameplate_pdf_bytes_to_png($pdf, $config);
        if (class_exists('Imagick')) {
            $im = new Imagick();
            $im->readImageBlob($png);
            $im->thumbnailImage(160, 0);
            $im->setImageFormat('png');
            $png = $im->getImageBlob();
            $im->clear();
            $im->destroy();
        }
        header('Content-Type: image/png');
        header('Cache-Control: private, max-age=30');
        header('Content-Length: ' . (string) strlen($png));
        echo $png;
        exit;
    }

    if ($method === 'POST' && $action === 'print') {
        nameplate_template_require_operator();
        $body = nameplate_template_read_json_body();
        $payload = is_array($body['payload'] ?? null) ? $body['payload'] : nameplate_template_editor_sample_payload('corrector');
        $payload['kind'] = nameplate_template_print_kind((string) ($payload['kind'] ?? 'corrector'));
        $fields = is_array($body['document'] ?? null) ? $body['document'] : null;
        if ($fields !== null) {
            $fields = nameplate_editor_normalize_document($fields);
            nameplate_validate_fields_document($fields);
            if (!is_array($fields['editorObjects'] ?? null)) {
                $fields['editorObjects'] = [];
            }
        }

        $previewContext = nameplate_build_preview_context($payload);
        $printData = [
            'kind' => (string) ($previewContext['kind'] ?? $payload['kind']),
            'serial' => (string) ($previewContext['serial'] ?? ''),
            'orderNumber' => trim((string) ($payload['orderNumber'] ?? '')),
            'productTitle' => trim((string) ($payload['productTitle'] ?? '')),
            'manufactureDate' => trim((string) ($payload['manufactureDate'] ?? '')),
            'organizationName' => trim((string) ($payload['organizationName'] ?? '')),
            'configText' => trim((string) ($payload['configText'] ?? '')),
            'orderConfig' => trim((string) ($payload['orderConfig'] ?? '')),
        ];

        if (is_array($body['printAgent'] ?? null)) {
            nameplate_set_print_agent_request_overrides($body['printAgent']);
        }

        $job = nameplate_build_print_job($printData, $fields);
        $config = nameplate_load_config();
        $pa = is_array($config['printAgent'] ?? null) ? $config['printAgent'] : [];

        nameplate_template_json(array_merge([
            'ok' => true,
            'kind' => $job['kind'],
            'serial' => $job['serial'],
            'engine' => $job['engine'],
            'template' => $job['template'] ?? null,
            'templatePath' => $job['templatePath'] ?? null,
            'filled' => (bool) ($job['filled'] ?? true),
            'userMessage' => 'Шильд подготовлен для печати',
        ], array_filter([
            'generated' => $job['generated'] ?? null,
            'downloadUrl' => $job['downloadUrl'] ?? ($job['generated']['downloadUrl'] ?? null),
            'previewUrl' => $job['previewUrl'] ?? ($job['generated']['previewUrl'] ?? null),
            'filename' => $job['filename'] ?? ($job['generated']['filename'] ?? null),
            'mime' => $job['mime'] ?? null,
            'printAgentUrl' => $job['printAgentUrl'] ?? ($pa['agentUrl'] ?? null),
            'printAgentToken' => $job['printAgentToken'] ?? null,
            'printFormat' => $job['printFormat'] ?? null,
            'tspl' => $job['tspl'] ?? null,
            'tsplDownloadUrl' => $job['tsplDownloadUrl'] ?? null,
            'printer' => $job['printer'] ?? null,
            'config' => nameplate_public_config(),
        ], static fn ($v) => $v !== null)));
    }

    if ($method === 'POST' && $action === 'apply-reference-layout') {
        nameplate_template_require_operator();
        require_once __DIR__ . '/lib/nameplate_reference_drawing.php';
        $body = nameplate_template_read_json_body();
        $kind = nameplate_template_kind_key((string) ($body['kind'] ?? nameplate_template_kind_from_request()));
        $document = nameplate_editor_document_from_reference_drawing($kind);
        if (is_array($body['document'] ?? null)) {
            $base = $body['document'];
            foreach (['templateId', 'templateName'] as $key) {
                if (!empty($base[$key])) {
                    $document[$key] = $base[$key];
                }
            }
        }
        nameplate_template_json([
            'ok' => true,
            'kind' => $kind,
            'document' => nameplate_template_client_document($document),
            'referenceDrawing' => nameplate_reference_drawing_id(),
            'referencePdf' => nameplate_reference_drawing_pdf_basename(),
        ]);
    }

    if ($method === 'POST' && $action === 'clear-all') {
        nameplate_template_require_operator();
        $body = nameplate_template_read_json_body();
        $kind = nameplate_template_kind_key((string) ($body['kind'] ?? nameplate_template_kind_from_request()));
        $base = is_array($body['document'] ?? null) ? $body['document'] : null;
        if (is_array($base)) {
            $document = nameplate_editor_clear_document($base);
        } else {
            $document = nameplate_clear_fields_document($kind);
        }
        nameplate_template_json([
            'ok' => true,
            'kind' => $kind,
            'document' => nameplate_template_client_document($document),
        ]);
    }

    if ($method === 'POST' && $action === 'reset-defaults') {
        nameplate_template_require_operator();
        $body = nameplate_template_read_json_body();
        $document = nameplate_reset_fields_to_defaults(nameplate_template_kind_from_request());
        if (is_array($body['document'] ?? null)) {
            $base = $body['document'];
            foreach (['templateId', 'templateName', 'pageWidthMm', 'pageHeightMm', 'refW', 'refH'] as $key) {
                if (array_key_exists($key, $base)) {
                    $document[$key] = $base[$key];
                }
            }
            $document = nameplate_editor_normalize_document($document);
        }
        nameplate_template_json([
            'ok' => true,
            'templateId' => (string) ($document['templateId'] ?? nameplate_template_id_from_request()),
            'kind' => nameplate_template_kind_from_request(),
            'document' => nameplate_template_client_document($document),
            'source' => (string) ($document['referenceTemplate'] ?? 'corrector-300.btw'),
        ]);
    }

    if ($method === 'POST' && $action === 'import-btw') {
        nameplate_template_require_operator();
        $body = nameplate_template_read_json_body();
        $btwFile = trim((string) ($body['btwFile'] ?? 'corrector-300.btw'));
        if ($btwFile === '') {
            nameplate_template_json(['ok' => false, 'error' => 'Укажите btwFile'], 400);
        }
        $base = is_array($body['document'] ?? null) ? $body['document'] : null;
        $document = nameplate_import_fields_from_btw($btwFile, $base);
        $document = nameplate_editor_normalize_document($document);
        nameplate_template_json([
            'ok' => true,
            'document' => nameplate_template_client_document($document),
            'source' => $btwFile,
        ]);
    }

    nameplate_template_json(['ok' => false, 'error' => 'Неизвестное действие'], 400);
} catch (InvalidArgumentException $e) {
    nameplate_template_json(['ok' => false, 'error' => $e->getMessage()], 400);
} catch (Throwable $e) {
    nameplate_template_json(['ok' => false, 'error' => $e->getMessage()], 500);
}
