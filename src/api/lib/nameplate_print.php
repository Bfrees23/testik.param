<?php
declare(strict_types=1);

require_once __DIR__ . '/nameplate_corrector_config.php';
require_once __DIR__ . '/nameplate_pdf.php';
require_once __DIR__ . '/nameplate_tspl.php';

function nameplate_repo_root(): string
{
    return dirname(__DIR__, 2);
}

function nameplate_data_dir(): string
{
    $root = nameplate_repo_root();
    if (is_dir($root . '/data')) {
        return $root . '/data';
    }

    return dirname($root) . '/data';
}

function nameplate_templates_dir(): string
{
    return nameplate_data_dir() . '/nameplate-templates';
}

function nameplate_template_kind_key(string $kind): string
{
    $k = strtolower(trim($kind));

    return ($k === '300' || $k === 'corrector') ? 'corrector' : $k;
}

/** Print pipeline kind: only corrector or complex (not template slug). */
function nameplate_template_print_kind(string $kind): string
{
    $k = strtolower(trim($kind));
    if ($k === '400' || $k === 'complex') {
        return 'complex';
    }

    return 'corrector';
}

/** @param array<string, mixed> $document */
function nameplate_template_document_print_kind(array $document): string
{
    $fromDoc = trim((string) ($document['productKind'] ?? ''));
    if ($fromDoc !== '') {
        return nameplate_template_print_kind($fromDoc);
    }

    return 'corrector';
}

function nameplate_template_id_key(string $templateId): string
{
    $id = strtolower(trim($templateId));
    if ($id === '' || $id === '300') {
        return 'corrector';
    }
    if ($id === 'corrector') {
        return 'corrector';
    }
    if (!preg_match('/^[a-z0-9][a-z0-9_-]{0,63}$/', $id)) {
        throw new InvalidArgumentException('Некорректный id шаблона: ' . $templateId);
    }

    return $id;
}

function nameplate_template_slug_from_name(string $name): string
{
    $slug = strtolower(trim($name));
    $slug = (string) preg_replace('/[^a-z0-9_-]+/', '-', $slug);
    $slug = trim($slug, '-');
    if ($slug === '' || $slug === 'corrector') {
        $slug = 'template';
    }

    return substr($slug, 0, 64);
}

function nameplate_unique_template_slug(string $baseSlug): string
{
    $slug = nameplate_template_slug_from_name($baseSlug);
    $candidate = $slug;
    $n = 2;
    while (is_readable(nameplate_fields_path($candidate))) {
        $candidate = $slug . '-' . $n;
        $n++;
    }

    return nameplate_template_id_key($candidate);
}

function nameplate_fields_filename(string $templateId = 'corrector'): string
{
    $id = nameplate_template_id_key($templateId);

    return $id . '-nameplate-template.fields.json';
}

/** @return list<array<string, mixed>> */
function nameplate_list_field_templates(): array
{
    $dir = nameplate_templates_dir();
    $templates = [];
    foreach (glob($dir . '/*-nameplate-template.fields.json') ?: [] as $path) {
        if (!is_readable($path)) {
            continue;
        }
        $raw = json_decode((string) file_get_contents($path), true);
        if (!is_array($raw)) {
            continue;
        }
        $base = basename($path);
        $id = (string) preg_replace('/-nameplate-template\.fields\.json$/', '', $base);
        $templates[] = [
            'id' => $id,
            'name' => (string) ($raw['templateName'] ?? nameplate_template_default_display_name($id)),
            'filename' => $base,
            'pageWidthMm' => (float) ($raw['pageWidthMm'] ?? 58),
            'pageHeightMm' => (float) ($raw['pageHeightMm'] ?? 20),
            'referenceBtw' => (string) ($raw['referenceTemplate'] ?? ''),
            'updatedAt' => @filemtime($path) ?: null,
            'protected' => nameplate_template_is_protected($id),
        ];
    }
    usort($templates, static function (array $a, array $b): int {
        return strcasecmp((string) $a['name'], (string) $b['name']);
    });

    return $templates;
}

function nameplate_template_is_protected(string $templateId): bool
{
    $id = nameplate_template_id_key($templateId);

    return in_array($id, ['corrector', 'complex'], true);
}

function nameplate_template_default_display_name(string $templateId): string
{
    $id = nameplate_template_id_key($templateId);
    if ($id === 'corrector') {
        return 'Корректор ТМ-07';
    }
    if ($id === 'complex') {
        return 'Комплекс ТМ-07';
    }

    return $id;
}

/** @return array{deletedId: string, filename: string} */
function nameplate_delete_fields_template(string $templateId): array
{
    $id = nameplate_template_id_key($templateId);
    if (nameplate_template_is_protected($id)) {
        throw new InvalidArgumentException('Системный шаблон нельзя удалить: ' . $id);
    }
    $path = nameplate_fields_path($id);
    if (!is_readable($path)) {
        throw new RuntimeException('Файл шаблона не найден: ' . basename($path));
    }
    $filename = basename($path);
    if (!@unlink($path)) {
        throw new RuntimeException('Не удалось удалить ' . $filename);
    }

    return [
        'deletedId' => $id,
        'filename' => $filename,
    ];
}

/**
 * Rename display name; optionally rename file slug for non-protected templates.
 *
 * @return array{templateId:string, document:array<string, mixed>, renamedFile:bool, templates:list<array<string, mixed>>}
 */
function nameplate_rename_fields_template(string $templateId, string $newName, ?string $newSlug = null): array
{
    $id = nameplate_template_id_key($templateId);
    $doc = nameplate_load_fields_document($id);
    $name = trim($newName);
    if ($name === '') {
        throw new InvalidArgumentException('Укажите название шаблона');
    }
    $doc['templateName'] = $name;
    $renamedFile = false;
    $targetId = $id;

    $slug = $newSlug !== null ? trim($newSlug) : '';
    if ($slug !== '' && !nameplate_template_is_protected($id)) {
        $candidate = nameplate_template_id_key($slug);
        if ($candidate !== $id) {
            if (nameplate_template_is_protected($candidate)) {
                throw new InvalidArgumentException('Нельзя переименовать в защищённый id: ' . $candidate);
            }
            $dest = nameplate_fields_path($candidate);
            if (is_readable($dest)) {
                throw new InvalidArgumentException('Шаблон с таким id уже существует: ' . $candidate);
            }
            $doc['templateId'] = $candidate;
            nameplate_save_fields_document($candidate, $doc);
            $oldPath = nameplate_fields_path($id);
            if (is_readable($oldPath)) {
                @unlink($oldPath);
            }
            $targetId = $candidate;
            $renamedFile = true;
        } else {
            nameplate_save_fields_document($id, $doc);
        }
    } else {
        nameplate_save_fields_document($id, $doc);
    }

    return [
        'templateId' => $targetId,
        'document' => $doc,
        'renamedFile' => $renamedFile,
        'templates' => nameplate_list_field_templates(),
    ];
}

/**
 * Duplicate a fields template under a new unique id.
 *
 * @return array{templateId:string, document:array<string, mixed>, saved:array<string, mixed>, templates:list<array<string, mixed>>}
 */
function nameplate_duplicate_fields_template(string $templateId, ?string $newName = null, ?string $newSlug = null): array
{
    $id = nameplate_template_id_key($templateId);
    $src = nameplate_load_fields_document($id);
    $name = trim((string) ($newName ?? ''));
    if ($name === '') {
        $name = (string) ($src['templateName'] ?? $id) . ' (копия)';
    }
    $slugBase = $newSlug !== null && trim($newSlug) !== '' ? trim($newSlug) : ($name !== '' ? $name : $id . '-copy');
    $slug = nameplate_unique_template_slug($slugBase);
    $doc = $src;
    $doc['templateId'] = $slug;
    $doc['templateName'] = $name;
    $saved = nameplate_save_fields_document($slug, $doc);

    return [
        'templateId' => $slug,
        'document' => $doc,
        'saved' => $saved,
        'templates' => nameplate_list_field_templates(),
    ];
}

function nameplate_fields_path(string $templateId = 'corrector'): string
{
    return nameplate_templates_dir() . '/' . nameplate_fields_filename($templateId);
}

/** @return array<string, mixed> */
function nameplate_load_fields_document(string $templateId = 'corrector'): array
{
    $id = nameplate_template_id_key($templateId);
    $path = nameplate_fields_path($id);
    if (!is_readable($path)) {
        throw new RuntimeException('Файл полей не найден: ' . basename($path));
    }
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data)) {
        throw new RuntimeException('Некорректный JSON: ' . basename($path));
    }

    require_once __DIR__ . '/nameplate_template_editor.php';

    $data = nameplate_editor_normalize_document($data);
    if (!isset($data['templateId'])) {
        $data['templateId'] = $id;
    }
    if (!isset($data['templateName']) || trim((string) $data['templateName']) === '') {
        $data['templateName'] = nameplate_template_default_display_name($id);
    }

    return $data;
}

/** @param array<string, mixed> $document */
function nameplate_validate_fields_document(array $document): void
{
    foreach (['pageWidthMm', 'pageHeightMm', 'refW', 'refH', 'dynamicFields'] as $key) {
        if (!array_key_exists($key, $document)) {
            throw new InvalidArgumentException('Отсутствует поле: ' . $key);
        }
    }
    if (!is_array($document['dynamicFields'])) {
        throw new InvalidArgumentException('dynamicFields должен быть объектом');
    }
}

/** @param array<string, mixed> $document */
function nameplate_save_fields_document(string $templateId, array $document): array
{
    require_once __DIR__ . '/nameplate_template_editor.php';
    $document = nameplate_editor_normalize_document($document);
    $id = nameplate_template_id_key((string) ($document['templateId'] ?? $templateId));
    $document['templateId'] = $id;
    $document = nameplate_editor_sanitize_utf8($document);
    nameplate_validate_fields_document($document);
    $path = nameplate_fields_path($id);
    $json = json_encode(
        nameplate_document_for_json_encode($document),
        JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR
    );
    if (file_put_contents($path, $json . "\n", LOCK_EX) === false) {
        throw new RuntimeException('Не удалось сохранить ' . basename($path));
    }

    return [
        'path' => $path,
        'filename' => basename($path),
        'savedAt' => gmdate('c'),
    ];
}

/** @return array<string, string> */
function nameplate_template_editor_sample_serial(string $kind = 'corrector'): string
{
    $prefix = nameplate_template_kind_key($kind) === 'complex' ? '400' : '300';
    $yy = (int) date('y');
    $mm = (int) date('m');

    return sprintf('%s%02d%02d128', $prefix, $yy, $mm);
}

/** @return array<string, string> */
function nameplate_template_editor_sample_payload(string $kind = 'corrector'): array
{
    $kindKey = nameplate_template_kind_key($kind);

    return [
        'kind' => $kindKey,
        'serial' => nameplate_template_editor_sample_serial($kind),
        'orderNumber' => 'ТМ00-000001',
        'productTitle' => $kindKey === 'complex'
            ? 'Комплекс ТМ-07'
            : 'Корректор объёма газа ТМ-07',
        'manufactureDate' => date('d.m.Y'),
        'configText' => "(И4;ГК;3м;ПАД(0,1-1,0)+УК;1,5м;\n"
            . "ПТГ(4-60)+УК(1/4NPT-125);1,5м;±0,27%;Ксж-3;\n"
            . 'ППД(0-10)+УК;1,5м;ПТТП (4-60)+УК(М14-80);1,5м)',
    ];
}

/** @return array<string, mixed> */
function nameplate_import_fields_from_btw(string $btwFile, ?array $baseDocument = null): array
{
    require_once __DIR__ . '/btw_parser.php';
    $info = btw_template_info($btwFile);
    $labelSpec = btw_extract_label_spec_file($info['path']);
    $layout = is_array($labelSpec['layout'] ?? null) ? $labelSpec['layout'] : [];
    $objects = is_array($labelSpec['objects'] ?? null) ? $labelSpec['objects'] : [];

    $doc = is_array($baseDocument) ? $baseDocument : nameplate_load_fields_document('corrector');
    $doc['referenceTemplate'] = $info['name'];
    if (isset($layout['refWidthPx'], $layout['refHeightPx'])) {
        $doc['refW'] = (int) $layout['refWidthPx'];
        $doc['refH'] = (int) $layout['refHeightPx'];
    }
    if (isset($layout['pageWidthMm'], $layout['pageHeightMm'])) {
        $doc['pageWidthMm'] = (float) $layout['pageWidthMm'];
        $doc['pageHeightMm'] = (float) $layout['pageHeightMm'];
    }

    $dynamic = is_array($doc['dynamicFields'] ?? null) ? $doc['dynamicFields'] : [];
    $byId = [];
    foreach ($objects as $object) {
        if (!is_array($object) || !isset($object['id'])) {
            continue;
        }
        $byId[(string) $object['id']] = $object;
    }

    $mapText = static function (array $layoutRow): array {
        $row = [];
        if (isset($layoutRow['xPx'])) {
            $row['x'] = (float) $layoutRow['xPx'];
        }
        if (isset($layoutRow['yPx'])) {
            $row['y'] = (float) $layoutRow['yPx'];
        }
        if (isset($layoutRow['wPx'])) {
            $row['w'] = (float) $layoutRow['wPx'];
        }
        if (isset($layoutRow['fontPt'])) {
            $row['fontPt'] = (float) $layoutRow['fontPt'];
        }

        return $row;
    };

    $btwToField = [
        'title' => 'productTitleShort',
        'release' => 'releaseLabel',
    ];
    foreach (['title', 'specLine1', 'specLine2', 'specLine3', 'release', 'releaseLabel'] as $btwId) {
        $fieldId = $btwToField[$btwId] ?? $btwId;
        $object = $byId[$btwId] ?? null;
        if (!is_array($object) || !is_array($object['layout'] ?? null)) {
            continue;
        }
        $row = $mapText($object['layout']);
        if ($fieldId === 'productTitleShort' && isset($row['x']) && (float) $row['x'] <= 0) {
            $row['x'] = 52.0;
        }
        $dynamic[$fieldId] = array_merge(
            is_array($dynamic[$fieldId] ?? null) ? $dynamic[$fieldId] : [],
            $row
        );
    }

    $serialObj = $byId['serial'] ?? null;
    if (is_array($serialObj) && is_array($serialObj['layout'] ?? null)) {
        $sl = $serialObj['layout'];
        $dynamic['serial'] = array_merge(
            is_array($dynamic['serial'] ?? null) ? $dynamic['serial'] : [],
            [
                'centerX' => (float) ($sl['centerXPx'] ?? $sl['xPx'] ?? 898.5),
                'y' => (float) ($sl['yPx'] ?? 310),
                'w' => (float) ($sl['wPx'] ?? 305),
                'fontPt' => (float) ($sl['fontPt'] ?? 3.6),
            ]
        );
    }

    $qrObj = $byId['qr'] ?? null;
    if (is_array($qrObj) && is_array($qrObj['layout'] ?? null)) {
        $ql = $qrObj['layout'];
        $dynamic['qr'] = array_merge(
            is_array($dynamic['qr'] ?? null) ? $dynamic['qr'] : [],
            [
                'x' => (float) ($ql['xPx'] ?? 746),
                'y' => (float) ($ql['yPx'] ?? 40),
                'size' => (float) ($ql['sizePx'] ?? 249),
                'sizeMm' => isset($ql['sizeMm']) ? (float) $ql['sizeMm'] : null,
            ]
        );
        if ($dynamic['qr']['sizeMm'] === null) {
            unset($dynamic['qr']['sizeMm']);
        }
    }

    $doc['dynamicFields'] = $dynamic;
    require_once __DIR__ . '/nameplate_template_editor.php';

    return nameplate_editor_normalize_document($doc);
}

/** @return array<string, mixed> */
function nameplate_reset_fields_to_defaults(string $kind = 'corrector'): array
{
    require_once __DIR__ . '/nameplate_reference_drawing.php';

    return nameplate_editor_document_from_reference_drawing($kind);
}

/** @return array<string, mixed> */
function nameplate_clear_fields_document(string $kind = 'corrector'): array
{
    require_once __DIR__ . '/nameplate_template_editor.php';
    $doc = nameplate_load_fields_document($kind);

    return nameplate_editor_clear_document([
        'referenceDrawing' => $doc['referenceDrawing'] ?? 'ТМР.754463.091',
        'referenceTemplate' => $doc['referenceTemplate'] ?? 'corrector-300.btw',
        'templateId' => (string) ($doc['templateId'] ?? 'corrector'),
        'templateName' => (string) ($doc['templateName'] ?? nameplate_template_default_display_name((string) ($doc['templateId'] ?? 'corrector'))),
        'pageWidthMm' => (float) ($doc['pageWidthMm'] ?? 58),
        'pageHeightMm' => (float) ($doc['pageHeightMm'] ?? 20),
        'refW' => (int) ($doc['refW'] ?? 1052),
        'refH' => (int) ($doc['refH'] ?? 364),
        'staticInTemplate' => is_array($doc['staticInTemplate'] ?? null) ? $doc['staticInTemplate'] : ['logo', 'title', 'border'],
        'dynamicFields' => [],
        'editorObjects' => [],
    ]);
}

/** @param array<string, mixed> $options */
function nameplate_create_new_fields_document(array $options): array
{
    require_once __DIR__ . '/nameplate_template_editor.php';

    $name = trim((string) ($options['name'] ?? 'Новый шаблон'));
    if ($name === '') {
        $name = 'Новый шаблон';
    }
    $slug = nameplate_unique_template_slug((string) ($options['slug'] ?? $name));
    $pageW = max(10.0, min(300.0, (float) ($options['pageWidthMm'] ?? 58)));
    $pageH = max(10.0, min(300.0, (float) ($options['pageHeightMm'] ?? 20)));
    $mode = (string) ($options['mode'] ?? 'blank');
    $dims = nameplate_editor_ref_dimensions($pageW, $pageH);

    if ($mode === 'copy' && is_array($options['sourceDocument'] ?? null)) {
        $doc = json_decode(json_encode($options['sourceDocument'], JSON_THROW_ON_ERROR), true, 512, JSON_THROW_ON_ERROR);
        $doc['templateId'] = $slug;
        $doc['templateName'] = $name;
        $doc['pageWidthMm'] = $pageW;
        $doc['pageHeightMm'] = $pageH;
        $doc['refW'] = $dims['refW'];
        $doc['refH'] = $dims['refH'];

        return nameplate_editor_normalize_document($doc);
    }

    if ($mode === 'defaults' || $mode === 'reference') {
        require_once __DIR__ . '/nameplate_reference_drawing.php';
        $doc = nameplate_editor_document_from_reference_drawing(
            nameplate_template_kind_key((string) ($options['kind'] ?? 'corrector'))
        );
    } elseif ($mode === 'btw') {
        $base = nameplate_editor_blank_document();
        $base['pageWidthMm'] = $pageW;
        $base['pageHeightMm'] = $pageH;
        $base['refW'] = $dims['refW'];
        $base['refH'] = $dims['refH'];
        $btw = trim((string) ($options['btwFile'] ?? 'corrector-300.btw'));
        try {
            $doc = nameplate_import_fields_from_btw($btw, $base);
        } catch (Throwable $e) {
            $doc = nameplate_editor_document_from_layout_default();
            $doc['pageWidthMm'] = $pageW;
            $doc['pageHeightMm'] = $pageH;
            $doc['refW'] = $dims['refW'];
            $doc['refH'] = $dims['refH'];
        }
    } else {
        $doc = nameplate_editor_scratch_document();
        $doc['pageWidthMm'] = $pageW;
        $doc['pageHeightMm'] = $pageH;
        $doc['refW'] = $dims['refW'];
        $doc['refH'] = $dims['refH'];
    }

    $doc['templateId'] = $slug;
    $doc['templateName'] = $name;
    $doc['pageWidthMm'] = $pageW;
    $doc['pageHeightMm'] = $pageH;
    $doc['refW'] = $dims['refW'];
    $doc['refH'] = $dims['refH'];

    return nameplate_editor_normalize_document($doc);
}

function nameplate_config_defaults(): array
{
    $defaults = [
        'autoSerialOnOrderOpen' => true,
        'autoPrintOnOrderOpen' => false,
        'engine' => 'raster',
        'htmlFallback' => false,
        'html' => [
            'templateCorrector' => 'tm07-corrector.html',
            'templateComplex' => 'pktm-complex.html',
            'pageWidthMm' => 58,
            'pageHeightMm' => 20,
            'dpi' => 203,
            'chromiumPath' => '',
        ],
        'pdf' => [
            'useTemplate' => true,
            'templateCorrector' => 'corrector-nameplate-template.pdf',
        ],
        'printAgent' => [
            'enabled' => true,
            'agentUrl' => 'http://127.0.0.1:18778',
            'printer' => 'TSC TE200',
            'format' => 'tspl',
            'dpi' => 203,
            'gapMm' => 2.0,
            'direction' => 1,
            'yOffsetMm' => 0,
            'density' => 15,
            'speed' => 2.0,
            'threshold' => 0.72,
            'homeBeforePrint' => false,
            'fallbackPreview' => false,
            'direct' => [
                'enabled' => false,
                'mode' => 'dev',
                'host' => '',
                'port' => 9100,
                'device' => '/dev/usb/lp0',
                'cupsQueue' => '',
            ],
            'dialog' => [
                'enabled' => false,
                'pageWidthMm' => 58,
                'pageHeightMm' => 20,
            ],
        ],
        'bartender' => [
            'agentUrl' => 'http://127.0.0.1:18777',
            'templateCorrector' => 'corrector-300.btw',
            'templateComplex' => 'pktm-complex.btw',
            'printer' => 'TSC TE200',
            'fieldSerial' => 'Serial',
            'fieldOrderNumber' => 'OrderNumber',
            'fieldProductTitle' => 'ProductTitle',
            'fieldManufactureDate' => 'ManufactureDate',
            'fieldConfigText' => 'ConfigText',
            'fieldReleaseLabel' => 'ReleaseLabel',
        ],
    ];

    $path = nameplate_repo_root() . '/config/defaults/nameplate-config.json';
    if (is_readable($path)) {
        $data = json_decode((string) file_get_contents($path), true);
        if (is_array($data)) {
            return nameplate_merge_config($defaults, $data);
        }
    }

    return $defaults;
}

function nameplate_merge_config(array $defaults, array $overrides): array
{
    foreach ($overrides as $key => $value) {
        if (is_array($value) && isset($defaults[$key]) && is_array($defaults[$key])) {
            $defaults[$key] = nameplate_merge_config($defaults[$key], $value);
        } else {
            $defaults[$key] = $value;
        }
    }

    return $defaults;
}

function nameplate_load_config(): array
{
    $config = nameplate_config_defaults();
    $path = nameplate_data_dir() . '/nameplate-config.json';
    if (is_readable($path)) {
        $data = json_decode((string) file_get_contents($path), true);
        if (is_array($data)) {
            $config = nameplate_merge_config($config, $data);
        }
    }

    $overrides = $GLOBALS['nameplate_print_agent_overrides'] ?? null;
    if (is_array($overrides) && $overrides !== []) {
        $pa = is_array($config['printAgent'] ?? null) ? $config['printAgent'] : [];
        if (array_key_exists('density', $overrides)) {
            $pa['density'] = max(0, min(15, (int) $overrides['density']));
        }
        if (array_key_exists('speed', $overrides)) {
            $pa['speed'] = max(0.5, min(12.0, (float) $overrides['speed']));
        }
        if (array_key_exists('yOffsetMm', $overrides)) {
            $pa['yOffsetMm'] = max(-20.0, min(20.0, (float) $overrides['yOffsetMm']));
        }
        if (array_key_exists('threshold', $overrides)) {
            $pa['threshold'] = max(0.2, min(0.99, (float) $overrides['threshold']));
        }
        $config['printAgent'] = $pa;
    }

    return $config;
}

/** @param array<string, mixed>|null $patch */
function nameplate_set_print_agent_request_overrides(?array $patch): void
{
    $GLOBALS['nameplate_print_agent_overrides'] = is_array($patch) ? $patch : null;
}

function nameplate_engine(array $config): string
{
    $engine = strtolower(trim((string) ($config['engine'] ?? 'raster')));
    if ($engine === 'pdf') {
        // Legacy alias: PDF intermediate is no longer the print path.
        return 'raster';
    }
    if ($engine === '') {
        return 'raster';
    }

    return $engine;
}

function nameplate_engine_is_raster(array $config): bool
{
    return nameplate_engine($config) === 'raster';
}

function nameplate_public_config(): array
{
    $config = nameplate_load_config();
    $html = is_array($config['html'] ?? null) ? $config['html'] : [];

    $pa = is_array($config['printAgent'] ?? null) ? $config['printAgent'] : [];

    return [
        'autoSerialOnOrderOpen' => (bool) ($config['autoSerialOnOrderOpen'] ?? true),
        'autoPrintOnOrderOpen' => (bool) ($config['autoPrintOnOrderOpen'] ?? true),
        'engine' => nameplate_engine($config),
        'htmlFallback' => (bool) ($config['htmlFallback'] ?? false),
        'html' => [
            'templateCorrector' => (string) ($html['templateCorrector'] ?? 'tm07-corrector.html'),
            'templateComplex' => (string) ($html['templateComplex'] ?? 'pktm-complex.html'),
            'pageWidthMm' => (int) ($html['pageWidthMm'] ?? 58),
            'pageHeightMm' => (int) ($html['pageHeightMm'] ?? 20),
        ],
        'pdf' => [
            'useTemplate' => (bool) (($config['pdf']['useTemplate'] ?? true)),
            'templateCorrector' => (string) (($config['pdf']['templateCorrector'] ?? 'corrector-nameplate-template.pdf')),
        ],
        'printAgent' => nameplate_public_print_agent($pa),
    ];
}

/**
 * Токен агента: из config или TM07_PRINT_AGENT_TOKEN.
 * Не отдавать в публичный config — только в job после bench_require_operator_session.
 *
 * @param array<string, mixed>|null $pa
 */
function nameplate_resolve_agent_token(?array $pa = null): string
{
    if ($pa === null) {
        $config = nameplate_load_config();
        $pa = is_array($config['printAgent'] ?? null) ? $config['printAgent'] : [];
    }
    $tok = trim((string) ($pa['agentToken'] ?? ''));
    if ($tok === '') {
        $envTok = getenv('TM07_PRINT_AGENT_TOKEN');
        $tok = ($envTok !== false) ? trim((string) $envTok) : '';
    }
    return $tok;
}

/**
 * @param array<string, mixed> $job
 * @param array<string, mixed> $pa
 * @return array<string, mixed>
 */
function nameplate_print_agent_token_required(): bool
{
    $flag = getenv('TM07_REQUIRE_PRINT_AGENT_TOKEN');
    if ($flag === false) {
        return false;
    }
    $v = strtolower(trim((string) $flag));
    return in_array($v, ['1', 'true', 'yes', 'on'], true);
}

function nameplate_with_print_agent_token(array $job, array $pa): array
{
    $tok = nameplate_resolve_agent_token($pa);
    if ($tok === '' && nameplate_print_agent_token_required()) {
        throw new RuntimeException(
            'TM07_PRINT_AGENT_TOKEN не задан (TM07_REQUIRE_PRINT_AGENT_TOKEN=1). Укажите токен в .env и в агенте печати.'
        );
    }
    if ($tok !== '') {
        $job['printAgentToken'] = $tok;
    }
    return $job;
}

/** @param array<string, mixed> $pa */
function nameplate_public_print_agent(array $pa): array
{
    return [
        'enabled' => (bool) ($pa['enabled'] ?? true),
        'agentUrl' => (string) ($pa['agentUrl'] ?? 'http://127.0.0.1:18778'),
        'printer' => (string) ($pa['printer'] ?? 'TSC TE200'),
        'format' => strtolower((string) ($pa['format'] ?? 'tspl')),
        'dpi' => (int) ($pa['dpi'] ?? 203),
        'gapMm' => (float) ($pa['gapMm'] ?? 2.0),
        'direction' => ((int) ($pa['direction'] ?? 1) === 0) ? 0 : 1,
        'yOffsetMm' => (float) ($pa['yOffsetMm'] ?? 0),
        'density' => max(0, min(15, (int) ($pa['density'] ?? 15))),
        'speed' => (float) ($pa['speed'] ?? 2.0),
        'threshold' => (float) ($pa['threshold'] ?? 0.72),
        'homeBeforePrint' => (bool) ($pa['homeBeforePrint'] ?? false),
        'fallbackPreview' => (bool) ($pa['fallbackPreview'] ?? true),
        // Факт наличия токена без раскрытия значения (агент с TM07_PRINT_AGENT_TOKEN).
        'agentTokenConfigured' => nameplate_resolve_agent_token($pa) !== '',
        'direct' => [
            'enabled' => (bool) (($pa['direct']['enabled'] ?? false)),
            'mode' => (string) (($pa['direct']['mode'] ?? 'dev')),
            'host' => (string) (($pa['direct']['host'] ?? '')),
            'port' => (int) (($pa['direct']['port'] ?? 9100)),
            'device' => (string) (($pa['direct']['device'] ?? '/dev/usb/lp0')),
            'cupsQueue' => (string) (($pa['direct']['cupsQueue'] ?? '')),
        ],
        'dialog' => [
            'enabled' => (bool) (($pa['dialog']['enabled'] ?? false)),
            'pageWidthMm' => (float) (($pa['dialog']['pageWidthMm'] ?? 58.0)),
            'pageHeightMm' => (float) (($pa['dialog']['pageHeightMm'] ?? 20.0)),
        ],
    ];
}

/**
 * Persist only calibrated printAgent knobs into data/nameplate-config.json.
 *
 * @param array<string, mixed> $patch
 * @return array{ok:bool, printAgent:array<string, mixed>, path:string}
 */
function nameplate_save_print_agent_settings(array $patch): array
{
    $path = nameplate_data_dir() . '/nameplate-config.json';
    $existing = [];
    if (is_readable($path)) {
        $decoded = json_decode((string) file_get_contents($path), true);
        if (is_array($decoded)) {
            $existing = $decoded;
        }
    }

    $pa = is_array($existing['printAgent'] ?? null) ? $existing['printAgent'] : [];
    if (array_key_exists('density', $patch)) {
        $pa['density'] = max(0, min(15, (int) $patch['density']));
    }
    if (array_key_exists('speed', $patch)) {
        $pa['speed'] = max(0.5, min(12.0, (float) $patch['speed']));
    }
    if (array_key_exists('yOffsetMm', $patch)) {
        $pa['yOffsetMm'] = max(-20.0, min(20.0, (float) $patch['yOffsetMm']));
    }
    if (array_key_exists('threshold', $patch)) {
        $pa['threshold'] = max(0.2, min(0.99, (float) $patch['threshold']));
    }

    $existing['printAgent'] = $pa;
    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        throw new RuntimeException('Не удалось создать каталог конфигурации');
    }
    $json = json_encode($existing, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false || file_put_contents($path, $json . "\n") === false) {
        throw new RuntimeException('Не удалось сохранить nameplate-config.json');
    }

    $merged = nameplate_load_config();
    $mergedPa = is_array($merged['printAgent'] ?? null) ? $merged['printAgent'] : [];

    return [
        'ok' => true,
        'path' => $path,
        'printAgent' => nameplate_public_print_agent($mergedPa),
    ];
}

/** @return array{prefix:string,yy:int,mm:int,seq:int,year:int,product:string,kind:string} */
function nameplate_parse_serial(string $serial, string $kind = ''): array
{
    $serial = trim($serial);
    if (!preg_match('/^(\d{3})(\d{2})(\d{2})(\d{3})$/', $serial, $m)) {
        throw new InvalidArgumentException('Неверный формат: 10 цифр (формат PPPYYMMNNN).');
    }

    $prefix = $m[1];
    $yy = (int) $m[2];
    $mm = (int) $m[3];
    $seq = (int) $m[4];

    if ($mm < 1 || $mm > 12) {
        throw new InvalidArgumentException('Некорректный месяц в серийном номере.');
    }
    if ($seq < 1 || $seq > 999) {
        throw new InvalidArgumentException('Некорректный порядковый номер в серийном номере.');
    }

    $expectedKind = match ($prefix) {
        '300' => 'corrector',
        '400' => 'complex',
        default => '',
    };

    if ($kind !== '' && $expectedKind !== '' && $kind !== $expectedKind) {
        throw new InvalidArgumentException('Тип изделия не совпадает с префиксом серийного номера.');
    }

    $product = $prefix === '400' ? 'ПК-ТМ' : 'ТМ-07';

    return [
        'prefix' => $prefix,
        'yy' => $yy,
        'mm' => $mm,
        'seq' => $seq,
        'year' => 2000 + $yy,
        'product' => $product,
        'kind' => $expectedKind !== '' ? $expectedKind : ($kind !== '' ? $kind : 'corrector'),
    ];
}

function nameplate_default_product_title(string $kind): string
{
    return $kind === 'complex'
        ? 'Комплекс промышленного учёта газа ПК-ТМ'
        : 'Корректор объема газа ТМ-07';
}

function nameplate_brand_label(): string
{
    return 'Техномер';
}

function nameplate_html_template_file(string $kind, ?array $config = null): string
{
    $cfg = $config ?? nameplate_load_config();
    $html = is_array($cfg['html'] ?? null) ? $cfg['html'] : [];
    $kindKey = strtolower(trim($kind));

    $map = [
        'corrector' => (string) ($html['templateCorrector'] ?? 'tm07-corrector.html'),
        'complex' => (string) ($html['templateComplex'] ?? 'pktm-complex.html'),
        '300' => (string) ($html['templateCorrector'] ?? 'tm07-corrector.html'),
        '400' => (string) ($html['templateComplex'] ?? 'pktm-complex.html'),
    ];

    if (!isset($map[$kindKey])) {
        throw new InvalidArgumentException('kind: corrector или complex');
    }

    return nameplate_templates_dir() . '/' . basename($map[$kindKey]);
}

function nameplate_bartender_template_file(string $kind, ?array $config = null): string
{
    $cfg = $config ?? nameplate_load_config();
    $bt = is_array($cfg['bartender'] ?? null) ? $cfg['bartender'] : [];
    $kindKey = strtolower(trim($kind));

    if ($kindKey === 'corrector' || $kindKey === '300') {
        $file = (string) ($bt['templateCorrector'] ?? 'corrector-300.btw');
    } elseif ($kindKey === 'complex' || $kindKey === '400') {
        $file = (string) ($bt['templateComplex'] ?? 'pktm-complex.btw');
    } else {
        throw new InvalidArgumentException('kind: corrector или complex');
    }

    return nameplate_templates_dir() . '/' . basename($file);
}

function nameplate_template_file(string $kind, ?array $config = null): string
{
    $cfg = $config ?? nameplate_load_config();
    if (nameplate_engine($cfg) === 'html') {
        return nameplate_html_template_file($kind, $cfg);
    }

    return nameplate_bartender_template_file($kind, $cfg);
}

function nameplate_format_serial_display(string $serial): string
{
    if (preg_match('/^(\d{3})(\d{2})(\d{2})(\d{3})$/', trim($serial), $m)) {
        return $m[1] . ' ' . $m[2] . $m[3] . ' ' . $m[4];
    }

    return trim($serial);
}

function nameplate_short_product_title(string $title, string $kind): string
{
    $title = trim($title);
    if ($title === '') {
        return nameplate_default_product_title($kind);
    }
    if (preg_match('/^(.+?\s+ТМ-07)/u', $title, $m)) {
        return trim($m[1]);
    }
    if (preg_match('/^(.+?\s+ПК-ТМ)/u', $title, $m)) {
        return trim($m[1]);
    }
    if (preg_match('/^(.+?)\s*\(/u', $title, $m)) {
        return trim($m[1]);
    }

    return $title;
}

function nameplate_extract_paren_block(string $text, int $start): string
{
    $len = strlen($text);
    $depth = 0;
    for ($i = $start; $i < $len; $i++) {
        $ch = $text[$i];
        if ($ch === '(') {
            $depth++;
        } elseif ($ch === ')') {
            $depth--;
            if ($depth === 0) {
                return substr($text, $start + 1, $i - $start - 1);
            }
        }
    }

    return '';
}

function nameplate_extract_config_block(string $text): string
{
    $text = trim($text);
    if ($text === '') {
        return '';
    }

    $patterns = [
        '/\(\s*(?:\x{0418}|I)\s*[1-4]\s*;/ui',
        '/\(\s*DN\d+/ui',
    ];

    foreach ($patterns as $pattern) {
        if (!preg_match($pattern, $text, $m, PREG_OFFSET_CAPTURE)) {
            continue;
        }
        $start = (int) $m[0][1];
        $inner = nameplate_extract_paren_block($text, $start);
        if ($inner === '') {
            continue;
        }
        if ($pattern === '/\(\s*DN\d+/ui') {
            if (!preg_match('/ПАД\(|ПТТ/u', $inner)) {
                continue;
            }
        }
        return nameplate_normalize_config_inner($inner);
    }

    return '';
}

function nameplate_normalize_config_inner(string $inner): string
{
    $inner = trim($inner);
    $inner = preg_replace('/\s+/u', '', $inner) ?? $inner;
    $inner = str_replace('.', ',', $inner);

    return $inner;
}

/**
 * Max glyphs per config line for drawing column 38 mm @ ~2.15 mm bold DejaVu.
 * Prefer Imagick metrics when available; else ≈30.
 */
function nameplate_config_wrap_max_chars(?array $fieldsDoc = null): int
{
    $refW = 1052.0;
    $refH = 364.0;
    $pageW = 58.0;
    $pageH = 20.0;
    $colMm = 38.0;
    $fontMm = 1.85;

    if (is_array($fieldsDoc)) {
        $refW = max(100.0, (float) ($fieldsDoc['refW'] ?? $refW));
        $refH = max(100.0, (float) ($fieldsDoc['refH'] ?? $refH));
        $pageW = max(1.0, (float) ($fieldsDoc['pageWidthMm'] ?? $pageW));
        $pageH = max(1.0, (float) ($fieldsDoc['pageHeightMm'] ?? $pageH));
        foreach ((array) ($fieldsDoc['editorObjects'] ?? []) as $obj) {
            if (!is_array($obj) || ($obj['id'] ?? '') !== 'specLine1') {
                continue;
            }
            if (isset($obj['w'])) {
                $colMm = ((float) $obj['w']) * $pageW / $refW;
            }
            if (isset($obj['fontMm']) && (float) $obj['fontMm'] > 0) {
                $fontMm = (float) $obj['fontMm'];
            }
            break;
        }
    }

    $maxWpx = ($colMm / $pageW) * $refW;
    $fontPx = ($fontMm / $pageH) * $refH;
    $fallback = max(20, (int) floor($maxWpx / max(1.0, $fontPx * 0.58)));

    if (!class_exists('Imagick')) {
        return $fallback;
    }

    try {
        require_once __DIR__ . '/nameplate_pdf.php';
        $fontPath = nameplate_pdf_font_path();
        $bold = preg_replace('/DejaVuSans\.ttf$/i', 'DejaVuSans-Bold.ttf', $fontPath);
        if (!is_string($bold) || !is_readable($bold)) {
            $bold = $fontPath;
        }
        $probe = new Imagick();
        $probe->newImage(8, 8, new ImagickPixel('white'));
        $draw = new ImagickDraw();
        $draw->setFont($bold);
        $draw->setFontSize($fontPx);
        $sample = 'И4;ДД+УК(0,5);1,5м;';
        $metrics = $probe->queryFontMetrics($draw, $sample, false);
        $probe->clear();
        $probe->destroy();
        $adv = (float) ($metrics['textWidth'] ?? 0);
        $chars = max(1, mb_strlen($sample, 'UTF-8'));
        if ($adv > 1.0) {
            return max(20, (int) floor($maxWpx / ($adv / $chars)));
        }
    } catch (Throwable) {
        // fall through
    }

    return $fallback;
}

/**
 * @return list<string>
 */
function nameplate_config_token_groups(string $inner): array
{
    $inner = nameplate_normalize_config_inner($inner);
    if ($inner === '') {
        return [];
    }
    if ($inner[0] === '(' && str_ends_with($inner, ')')) {
        $inner = nameplate_normalize_config_inner(substr($inner, 1, -1));
    }

    $parts = preg_split('/(?<=;)/u', $inner) ?: [$inner];
    $tokens = [];
    foreach ($parts as $part) {
        $part = (string) $part;
        if ($part !== '') {
            $tokens[] = $part;
        }
    }

    $groups = [];
    foreach ($tokens as $tok) {
        if ($groups !== [] && preg_match('/^1,5м;$/u', $tok)) {
            $groups[count($groups) - 1] .= $tok;
            continue;
        }
        $groups[] = $tok;
    }

    return $groups;
}

/**
 * Measure text width in editor canvas px at config font size.
 */
function nameplate_config_text_width_px(string $text, ?array $fieldsDoc = null): float
{
    if ($text === '' || !class_exists('Imagick')) {
        return (float) mb_strlen($text, 'UTF-8') * 12.0;
    }

    $refH = 364.0;
    $pageH = 20.0;
    $fontMm = 1.85;
    if (is_array($fieldsDoc)) {
        $refH = max(100.0, (float) ($fieldsDoc['refH'] ?? $refH));
        $pageH = max(1.0, (float) ($fieldsDoc['pageHeightMm'] ?? $pageH));
        foreach ((array) ($fieldsDoc['editorObjects'] ?? []) as $obj) {
            if (is_array($obj) && ($obj['id'] ?? '') === 'specLine1' && isset($obj['fontMm'])) {
                $fontMm = (float) $obj['fontMm'];
                break;
            }
        }
    }
    $fontPx = ($fontMm / $pageH) * $refH;

    try {
        require_once __DIR__ . '/nameplate_pdf.php';
        $fontPath = nameplate_pdf_font_path();
        $bold = preg_replace('/DejaVuSans\.ttf$/i', 'DejaVuSans-Bold.ttf', $fontPath);
        if (!is_string($bold) || !is_readable($bold)) {
            $bold = $fontPath;
        }
        $probe = new Imagick();
        $probe->newImage(8, 8, new ImagickPixel('white'));
        $draw = new ImagickDraw();
        $draw->setFont($bold);
        $draw->setFontSize($fontPx);
        $w = (float) ($probe->queryFontMetrics($draw, $text, false)['textWidth'] ?? 0);
        $probe->clear();
        $probe->destroy();

        return $w > 0 ? $w : ((float) mb_strlen($text, 'UTF-8') * 12.0);
    } catch (Throwable) {
        return (float) mb_strlen($text, 'UTF-8') * 12.0;
    }
}

function nameplate_config_column_width_px(?array $fieldsDoc = null): float
{
    $refW = 1052.0;
    $pageW = 58.0;
    $colMm = 38.0;
    if (is_array($fieldsDoc)) {
        $refW = max(100.0, (float) ($fieldsDoc['refW'] ?? $refW));
        $pageW = max(1.0, (float) ($fieldsDoc['pageWidthMm'] ?? $pageW));
        foreach ((array) ($fieldsDoc['editorObjects'] ?? []) as $obj) {
            if (is_array($obj) && ($obj['id'] ?? '') === 'specLine1' && isset($obj['w'])) {
                return (float) $obj['w'];
            }
        }
    }

    return ($colMm / $pageW) * $refW;
}

/**
 * Split corrector config into ≤3 label lines for the text column.
 * Optimal contiguous partition of sensor groups by measured ink width
 * (matches BarTender packing better than greedy fill).
 *
 * @return array{0:string,1:string,2:string}
 */
function nameplate_wrap_config_lines(string $inner, ?int $maxLen = null, ?array $fieldsDoc = null): array
{
    $groups = nameplate_config_token_groups($inner);
    if ($groups === []) {
        return ['', '', ''];
    }

    $n = count($groups);
    if ($n === 1) {
        $line = $groups[0];
        if (!str_starts_with($line, '(')) {
            $line = '(' . rtrim($line, ';') . ')';
        }

        return [$line, '', ''];
    }

    $widthOf = static function (int $from, int $to) use ($groups, $fieldsDoc): float {
        if ($from >= $to) {
            return 0.0;
        }
        $chunk = implode('', array_slice($groups, $from, $to - $from));

        return nameplate_config_text_width_px($chunk, $fieldsDoc);
    };

    $best = null;
    $bestScore = INF;
    // One or two lines when few groups.
    if ($n === 2) {
        $best = [0, 1, 2];
        $bestScore = max($widthOf(0, 1), $widthOf(1, 2));
    }

    for ($i = 1; $i < $n; $i++) {
        for ($j = $i; $j <= $n; $j++) {
            // Partition [0,i) | [i,j) | [j,n); empty middle/last allowed only at end.
            if ($j < $i) {
                continue;
            }
            $w0 = $widthOf(0, $i);
            $w1 = $j > $i ? $widthOf($i, $j) : 0.0;
            $w2 = $j < $n ? $widthOf($j, $n) : 0.0;
            // Prefer using up to 3 lines; penalize empty early lines.
            if ($w1 <= 0.0 && $w2 > 0.0) {
                continue;
            }
            $score = max($w0, $w1, $w2);
            // Slight preference for more even fill.
            $used = ($w0 > 0 ? 1 : 0) + ($w1 > 0 ? 1 : 0) + ($w2 > 0 ? 1 : 0);
            $mean = ($w0 + $w1 + $w2) / max(1, $used);
            $score += abs($w0 - $mean) * 0.05 + abs($w1 - $mean) * 0.05 + abs($w2 - $mean) * 0.05;
            if ($score < $bestScore) {
                $bestScore = $score;
                $best = [$i, $j, $n];
            }
        }
    }

    if ($best === null) {
        $best = [1, min(2, $n), $n];
    }

    $lines = [
        implode('', array_slice($groups, 0, $best[0])),
        implode('', array_slice($groups, $best[0], max(0, $best[1] - $best[0]))),
        implode('', array_slice($groups, $best[1], max(0, $best[2] - $best[1]))),
    ];

    if ($lines[0] !== '' && !str_starts_with($lines[0], '(')) {
        $lines[0] = '(' . $lines[0];
    }
    $last = 2;
    while ($last > 0 && $lines[$last] === '') {
        $last--;
    }
    if ($lines[$last] !== '' && !str_ends_with($lines[$last], ')')) {
        $lines[$last] = rtrim($lines[$last], ';');
        $lines[$last] .= ')';
    }

    return [$lines[0], $lines[1], $lines[2]];
}

function nameplate_release_label(string $manufactureMonth): string
{
    return $manufactureMonth !== '' ? 'Выпуск ' . $manufactureMonth : '';
}


function nameplate_fetch_order_payload_by_number(PDO $pdo, string $orderNumber): ?array
{
    $orderNumber = trim($orderNumber);
    if ($orderNumber === '') {
        return null;
    }

    if (bench_is_firebird($pdo)) {
        $sql = 'SELECT FIRST 1 ORDER_PAYLOAD FROM TM07_BENCH_SESSION WHERE ORDER_NUMBER = ? ORDER BY ID DESC';
    } else {
        $sql = "SELECT ORDER_PAYLOAD FROM TM07_BENCH_SESSION WHERE ORDER_NUMBER = ? ORDER BY ID DESC LIMIT 1";
    }
    $st = $pdo->prepare($sql);
    $st->execute([$orderNumber]);
    $raw = $st->fetchColumn();
    if (!is_string($raw) || trim($raw) === '') {
        return null;
    }
    $decoded = json_decode($raw, true);

    return is_array($decoded) ? $decoded : null;
}

function nameplate_blob_from_order_payload(?array $payload): string
{
    if (!is_array($payload)) {
        return '';
    }

    $blob = trim((string) ($payload['orderTextBlob'] ?? ''));
    if ($blob !== '') {
        return $blob;
    }

    if (isset($payload['row']) && is_array($payload['row'])) {
        $parts = [];
        foreach ($payload['row'] as $value) {
            if (is_string($value) && trim($value) !== '') {
                $parts[] = trim($value);
            }
        }
        $blob = trim(implode(' ', $parts));
        if ($blob !== '') {
            return $blob;
        }
    }

    return '';
}

/** @param array<string, scalar|null> $data */
function nameplate_enrich_payload_from_session(array $data): array
{
    if (trim((string) ($data['orderConfig'] ?? '')) !== '') {
        return $data;
    }

    $orderNumber = trim((string) ($data['orderNumber'] ?? ''));
    if ($orderNumber === '') {
        return $data;
    }

    try {
        if (!function_exists('bench_pdo')) {
            require_once __DIR__ . '/../bench_context.php';
        }
        $pdo = bench_pdo();
        $payload = null;
        $wsId = $_SESSION[BENCH_SESSION_WORKSTATION] ?? null;
        $session = bench_get_active_order_session($pdo, $wsId ? (int) $wsId : null);
        if ($session && trim((string) ($session['ORDER_NUMBER'] ?? '')) === $orderNumber) {
            $decoded = json_decode((string) ($session['ORDER_PAYLOAD'] ?? ''), true);
            if (is_array($decoded)) {
                $payload = $decoded;
            }
        }
        if (!is_array($payload)) {
            $payload = nameplate_fetch_order_payload_by_number($pdo, $orderNumber);
        }

        $blob = nameplate_blob_from_order_payload($payload);
        if ($blob !== '') {
            $data['orderConfig'] = $blob;
        }
        if (trim((string) ($data['productTitle'] ?? '')) === '') {
            $title = trim((string) ($payload['productTitle'] ?? ''));
            if ($title === '') {
                $title = nameplate_find_corrector_line($blob);
            }
            if ($title !== '') {
                $data['productTitle'] = $title;
            }
        }
    } catch (Throwable) {
        // optional enrichment
    }

    return $data;
}

/** @param array<string, scalar|null> $data */
function nameplate_build_preview_context(array $data): array
{
    $kind = nameplate_template_print_kind((string) ($data['kind'] ?? 'corrector'));
    $data['kind'] = $kind;
    $serial = trim((string) ($data['serial'] ?? ''));
    try {
        if ($serial !== '') {
            nameplate_parse_serial($serial, $kind);
        }
    } catch (InvalidArgumentException) {
        $data['serial'] = nameplate_template_editor_sample_serial($kind);
    }
    if ($serial === '') {
        $data['serial'] = nameplate_template_editor_sample_serial($kind);
    }

    try {
        return nameplate_build_context($data);
    } catch (InvalidArgumentException) {
        $fallback = nameplate_template_editor_sample_payload($kind);
        foreach (['serial', 'orderNumber', 'productTitle', 'manufactureDate', 'configText'] as $key) {
            if (trim((string) ($data[$key] ?? '')) === '' && isset($fallback[$key])) {
                $data[$key] = $fallback[$key];
            }
        }

        return nameplate_build_context($data);
    }
}

/** @param array<string, scalar|null> $data */
function nameplate_build_context(array $data): array
{
    $data = nameplate_enrich_payload_from_session($data);
    $serial = trim((string) ($data['serial'] ?? ''));
    $kind = strtolower(trim((string) ($data['kind'] ?? 'corrector')));
    if ($serial === '') {
        throw new InvalidArgumentException('serial обязателен');
    }

    $parsed = nameplate_parse_serial($serial, $kind);
    $kind = $parsed['kind'];

    $manufactureMonth = sprintf('%02d.%d', $parsed['mm'], $parsed['year']);
    $manufactureDate = sprintf('01.%02d.%d', $parsed['mm'], $parsed['year']);
    if (!empty($data['manufactureDate'])) {
        $manufactureDate = trim((string) $data['manufactureDate']);
    }

    $productTitle = trim((string) ($data['productTitle'] ?? ''));
    if ($productTitle === '') {
        $productTitle = nameplate_default_product_title($kind);
    }

    if ($kind === 'corrector') {
        $correctorLine = nameplate_find_corrector_line(trim((string) ($data['orderConfig'] ?? '')));
        if ($correctorLine !== '') {
            $productTitle = $correctorLine;
        } elseif (!preg_match('/Корректор\s+объ[её]?ма\s+газа\s+ТМ-07/ui', $productTitle)) {
            $productTitle = nameplate_default_product_title('corrector');
        }
    }

    $productTitleShort = nameplate_short_product_title($productTitle, $kind);
    if ($kind === 'corrector') {
        $configText = nameplate_resolve_corrector_config_text($data, $productTitle);
    } else {
        $configText = trim((string) ($data['configText'] ?? ''));
        if ($configText === '') {
            $configText = nameplate_extract_config_block((string) ($data['orderConfig'] ?? ''));
        }
        if ($configText === '') {
            $configText = nameplate_extract_config_block($productTitle);
        }
        if ($configText === '') {
            $blob = trim($productTitle . ' ' . (string) ($data['orderConfig'] ?? ''));
            $configText = nameplate_extract_config_block($blob);
        }
    }
    [$specLine1, $specLine2, $specLine3] = nameplate_wrap_config_lines(
        $configText,
        null,
        $GLOBALS['nameplate_fields_override'] ?? null
    );
    $releaseLabel = nameplate_release_label($manufactureMonth);
    if (trim((string) ($data['releaseLabel'] ?? '')) !== '') {
        $releaseLabel = trim((string) $data['releaseLabel']);
    }

    return [
        'serial' => $serial,
        'serialDisplay' => nameplate_format_serial_display($serial),
        'prefix' => $parsed['prefix'],
        'yy' => sprintf('%02d', $parsed['yy']),
        'mm' => sprintf('%02d', $parsed['mm']),
        'seq' => sprintf('%03d', $parsed['seq']),
        'year' => (string) $parsed['year'],
        'product' => $parsed['product'],
        'kind' => $kind,
        'productTitle' => $productTitle,
        'productTitleShort' => $productTitleShort,
        'brandLabel' => nameplate_brand_label(),
        'configText' => $configText,
        'specLine1' => $specLine1,
        'specLine2' => $specLine2,
        'specLine3' => $specLine3,
        'releaseLabel' => $releaseLabel,
        'orderNumber' => trim((string) ($data['orderNumber'] ?? '')),
        'manufactureDate' => $manufactureDate,
        'manufactureMonth' => $manufactureMonth,
        'organizationName' => trim((string) ($data['organizationName'] ?? 'ООО «Техномер»')),
    ];
}

/** @param array<string, string> $context */
function nameplate_fill_template(string $html, array $context): string
{
    // qrDataUrl must stay unescaped (data: URL).
    if (function_exists('nameplate_fill_template_ex')) {
        return nameplate_fill_template_ex($html, $context, ['qrDataUrl']);
    }
    $out = $html;
    foreach ($context as $key => $value) {
        $out = str_replace('{{' . $key . '}}', htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'), $out);
    }

    return $out;
}

/** @param array<string, scalar|null> $data */
function nameplate_render_html(array $data, ?array $config = null): string
{
    $cfg = $config ?? nameplate_load_config();
    $context = nameplate_build_context($data);
    $templatePath = nameplate_html_template_file($context['kind'], $cfg);
    if (!is_readable($templatePath)) {
        throw new RuntimeException('HTML-шаблон не найден: ' . basename($templatePath));
    }

    $html = file_get_contents($templatePath);
    if (!is_string($html) || trim($html) === '') {
        throw new RuntimeException('Пустой HTML-шаблон: ' . basename($templatePath));
    }

    // Prefer raster-ready HTML (server QR, no auto-print) when helper is available.
    if (function_exists('nameplate_prepare_html_for_raster')) {
        return nameplate_prepare_html_for_raster($html, $context, $cfg);
    }

    return nameplate_fill_template($html, $context);
}

/** @param array<string, string> $context */
function nameplate_build_bartender_fields(array $context, ?array $config = null): array
{
    $cfg = $config ?? nameplate_load_config();
    $bt = is_array($cfg['bartender'] ?? null) ? $cfg['bartender'] : [];
    $fields = [];

    $configInner = $context['configText'] ?? '';
    $configWrapped = $configInner !== '' ? '(' . ltrim($configInner, '(') : '';
    if ($configWrapped !== '' && !str_ends_with($configWrapped, ')')) {
        $configWrapped .= ')';
    }

    $map = [
        (string) ($bt['fieldSerial'] ?? 'Serial') => $context['serial'],
        (string) ($bt['fieldOrderNumber'] ?? 'OrderNumber') => $context['orderNumber'],
        (string) ($bt['fieldProductTitle'] ?? 'ProductTitle') => $context['productTitle'],
        (string) ($bt['fieldManufactureDate'] ?? 'ManufactureDate') => $context['manufactureDate'],
        (string) ($bt['fieldConfigText'] ?? 'ConfigText') => $configWrapped,
        (string) ($bt['fieldReleaseLabel'] ?? 'ReleaseLabel') => $context['releaseLabel'] ?? '',
        'SpecLine1' => $context['specLine1'] ?? '',
        'SpecLine2' => $context['specLine2'] ?? '',
        'SpecLine3' => $context['specLine3'] ?? '',
        'ProductTitleShort' => $context['productTitleShort'] ?? '',
    ];

    foreach ($map as $name => $value) {
        $name = trim($name);
        if ($name === '' || $value === '') {
            continue;
        }
        $fields[$name] = $value;
    }

    return $fields;
}

/** @param array<string, string> $fields */
function nameplate_build_btxml(string $templatePath, array $fields, string $printer = ''): string
{
    $parts = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<XMLScript Version="2.0">',
        '  <Command Name="PrintNameplate">',
        '    <Print>',
        '      <Format>' . htmlspecialchars(basename($templatePath), ENT_XML1 | ENT_QUOTES, 'UTF-8') . '</Format>',
    ];

    foreach ($fields as $name => $value) {
        if ($value === '') {
            continue;
        }
        $parts[] = '      <NamedSubString Name="' . htmlspecialchars($name, ENT_XML1 | ENT_QUOTES, 'UTF-8') . '">';
        $parts[] = '        <Value>' . htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8') . '</Value>';
        $parts[] = '      </NamedSubString>';
    }

    if ($printer !== '') {
        $parts[] = '      <PrintSetup>';
        $parts[] = '        <Printer>' . htmlspecialchars($printer, ENT_XML1 | ENT_QUOTES, 'UTF-8') . '</Printer>';
        $parts[] = '      </PrintSetup>';
    }

    $parts[] = '    </Print>';
    $parts[] = '  </Command>';
    $parts[] = '</XMLScript>';

    return implode("\n", $parts) . "\n";
}

/** @param array<string, scalar|null> $data */
function nameplate_resolve_fields_override(array $data, ?array $fieldsOverride = null): ?array
{
    if (is_array($fieldsOverride)) {
        return $fieldsOverride;
    }

    require_once __DIR__ . '/nameplate_template_editor.php';

    $templateId = trim((string) ($data['templateId'] ?? ''));
    if ($templateId === '') {
        $templateId = nameplate_template_print_kind((string) ($data['kind'] ?? 'corrector'));
    }

    try {
        $doc = nameplate_load_fields_document($templateId);
    } catch (Throwable $e) {
        $doc = null;
    }

    if (is_array($doc) && nameplate_template_is_blank_canvas($doc)) {
        $objects = $doc['editorObjects'] ?? [];
        if (is_array($objects) && count($objects) > 0) {
            return $doc;
        }
    }

    // Canonical production layout: drawing ТМР.754463.091
    require_once __DIR__ . '/nameplate_reference_drawing.php';
    try {
        return nameplate_editor_document_from_reference_drawing($templateId);
    } catch (Throwable $e) {
        return is_array($doc) ? $doc : null;
    }
}

/** @param array<string, scalar|null> $data */
function nameplate_build_print_job(array $data, ?array $fieldsOverride = null): array
{
    $config = nameplate_load_config();
    $context = nameplate_build_context($data);
    $engine = nameplate_engine($config);
    $pa = is_array($config['printAgent'] ?? null) ? $config['printAgent'] : [];
    $fields = nameplate_build_bartender_fields($context, $config);
    $printer = (string) ($pa['printer'] ?? 'TSC TE200');
    $fieldsOverride = nameplate_resolve_fields_override($data, $fieldsOverride);

    if (nameplate_engine_is_raster($config)) {
        require_once __DIR__ . '/nameplate_tspl.php';
        $printFormat = strtolower((string) ($pa['format'] ?? 'tspl'));
        $png = null;
        $tspl = null;
        $pdf = null;

        if ($printFormat === 'pdf') {
            $pdf = nameplate_generate_pdf_file($data, $config, $fieldsOverride);
            try {
                $png = nameplate_generate_png_file($data, $config, $fieldsOverride);
            } catch (Throwable $e) {
                error_log('nameplate PNG generation failed: ' . $e->getMessage());
            }
        } else {
            try {
                $tspl = nameplate_generate_tspl_file($data, $config, $fieldsOverride);
                $png = [
                    'filename' => (string) ($tspl['pngFilename'] ?? ''),
                    'path' => (string) ($tspl['pngPath'] ?? ''),
                    'downloadUrl' => (string) ($tspl['pngDownloadUrl'] ?? ''),
                    'previewUrl' => (string) ($tspl['previewUrl'] ?? ''),
                    'pngDownloadUrl' => (string) ($tspl['pngDownloadUrl'] ?? ''),
                    'mime' => 'image/png',
                    'filled' => true,
                ];
            } catch (Throwable $e) {
                error_log('nameplate TSPL generation failed: ' . $e->getMessage());
                $png = nameplate_generate_png_file($data, $config, $fieldsOverride);
            }
        }

        $previewUrl = is_array($png) ? ($png['previewUrl'] ?? null) : null;
        $downloadUrl = is_array($png) ? ($png['downloadUrl'] ?? null) : null;
        if ($printFormat === 'pdf' && is_array($pdf)) {
            $downloadUrl = $pdf['downloadUrl'] ?? $downloadUrl;
            $previewUrl = $pdf['previewUrl'] ?? $previewUrl;
        }

        return nameplate_with_print_agent_token([
            'kind' => $context['kind'],
            'serial' => $context['serial'],
            'orderNumber' => $context['orderNumber'],
            'productTitle' => $context['productTitle'],
            'manufactureDate' => $context['manufactureDate'],
            'engine' => 'raster',
            'template' => 'drawing-tmr-754463-091',
            'templatePath' => nameplate_fields_path(
                is_array($fieldsOverride) ? (string) ($fieldsOverride['templateId'] ?? 'corrector') : 'corrector'
            ),
            'templateId' => is_array($fieldsOverride) ? (string) ($fieldsOverride['templateId'] ?? '') : '',
            'blankCanvas' => is_array($fieldsOverride),
            'generated' => $pdf ?? $png,
            'downloadUrl' => $downloadUrl,
            'previewUrl' => $previewUrl,
            'pngDownloadUrl' => is_array($png) ? ($png['pngDownloadUrl'] ?? $png['downloadUrl'] ?? null) : null,
            'filename' => is_array($png) ? ($png['filename'] ?? null) : (is_array($pdf) ? ($pdf['filename'] ?? null) : null),
            'filled' => true,
            'mime' => $printFormat === 'pdf' ? 'application/pdf' : 'image/png',
            'printer' => $printer,
            'printAgentUrl' => (string) ($pa['agentUrl'] ?? 'http://127.0.0.1:18778'),
            'printFormat' => $printFormat,
            'tspl' => $tspl,
            'tsplDownloadUrl' => is_array($tspl) ? ($tspl['downloadUrl'] ?? null) : null,
        ], $pa);
    }

    if ($engine === 'html') {
        $templatePath = nameplate_html_template_file($context['kind'], $config);
        $printFormat = strtolower((string) ($pa['format'] ?? 'tspl'));
        $generated = nameplate_generate_html_tspl_file($data, $config);
        $tspl = is_array($generated['tspl'] ?? null) ? $generated['tspl'] : null;

        return nameplate_with_print_agent_token([
            'kind' => $context['kind'],
            'serial' => $context['serial'],
            'orderNumber' => $context['orderNumber'],
            'productTitle' => $context['productTitle'],
            'manufactureDate' => $context['manufactureDate'],
            'engine' => 'html',
            'template' => basename($templatePath),
            'templatePath' => $templatePath,
            'generated' => $generated,
            'downloadUrl' => $generated['downloadUrl'],
            'previewUrl' => $generated['previewUrl'],
            'pngDownloadUrl' => $generated['pngDownloadUrl'] ?? $generated['downloadUrl'],
            'filename' => $generated['filename'],
            'filled' => true,
            'mime' => 'image/png',
            'printer' => $printer,
            'printAgentUrl' => (string) ($pa['agentUrl'] ?? 'http://127.0.0.1:18778'),
            'printFormat' => $printFormat,
            'tspl' => $tspl,
            'tsplDownloadUrl' => is_array($tspl) ? ($tspl['downloadUrl'] ?? null) : null,
            'html' => (string) ($generated['html'] ?? nameplate_render_html($data, $config)),
            'htmlFallback' => false,
        ], $pa);
    }

    $templatePath = nameplate_bartender_template_file($context['kind'], $config);
    $bt = is_array($config['bartender'] ?? null) ? $config['bartender'] : [];
    $job = [
        'kind' => $context['kind'],
        'serial' => $context['serial'],
        'orderNumber' => $context['orderNumber'],
        'productTitle' => $context['productTitle'],
        'manufactureDate' => $context['manufactureDate'],
        'engine' => nameplate_engine_is_btw($config) ? 'btw' : 'bartender',
        'template' => basename($templatePath),
        'templatePath' => $templatePath,
        'printer' => $printer,
        'fields' => $fields,
        'agentUrl' => (string) ($bt['agentUrl'] ?? 'http://127.0.0.1:18777'),
        'btxml' => nameplate_build_btxml($templatePath, $fields, $printer),
    ];

    if (nameplate_engine_is_btw($config)) {
        $job['generated'] = nameplate_generate_btw_files($data, $job);
        $job['downloadUrl'] = $job['generated']['downloadUrl'];
        $job['filename'] = $job['generated']['filename'];
        if ((bool) ($config['htmlFallback'] ?? false)) {
            $job['html'] = nameplate_render_html($data, $config);
            $job['htmlFallback'] = true;
        }
        return nameplate_with_print_agent_token($job, $pa);
    }

    $job['htmlFallback'] = (bool) ($config['htmlFallback'] ?? true);
    $job['html'] = nameplate_render_html($data, $config);

    return nameplate_with_print_agent_token($job, $pa);
}

function nameplate_engine_is_btw(array $config): bool
{
    return in_array(nameplate_engine($config), ['btw', 'bartender'], true);
}

function nameplate_generated_dir(): string
{
    $dir = nameplate_data_dir() . '/nameplate-generated';
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        throw new RuntimeException('Не удалось создать каталог nameplate-generated');
    }

    return $dir;
}

function nameplate_generated_basename(string $serial, string $kind): string
{
    $serial = trim($serial);
    $kind = strtolower(trim($kind));
    if (!preg_match('/^\d{10}$/', $serial)) {
        throw new InvalidArgumentException('serial: 10 цифр');
    }
    if ($kind !== 'corrector' && $kind !== 'complex') {
        throw new InvalidArgumentException('kind: corrector или complex');
    }

    return $serial . '-' . $kind . '.btw';
}

function nameplate_safe_generated_file(string $name): string
{
    $base = basename(str_replace('\\', '/', $name));
    if ($base === '' || $base === '.' || $base === '..') {
        throw new InvalidArgumentException('Некорректный тип файла');
    }
    if (!preg_match('/^\d{10}-(?:corrector|complex)\.(?:btw|pdf|png|tspl|fields\.json|btxml)$/', $base)) {
        throw new InvalidArgumentException('Некорректный тип производственного файла');
    }

    return $base;
}

function nameplate_patch_btw_metadata_title(string $path, string $serial): void
{
    $data = file_get_contents($path);
    if ($data === false) {
        return;
    }

    $title = 'SN ' . trim($serial);
    $patched = preg_replace('/(<Title>)(.*?)(<\/Title>)/s', '$1' . $title . '$3', $data, 1, $count);
    if ($count > 0 && is_string($patched)) {
        file_put_contents($path, $patched);
    }
}

/** @param array<string, mixed> $job */
function nameplate_generate_btw_files(array $data, array $job): array
{
    $context = nameplate_build_context($data);
    $templatePath = (string) ($job['templatePath'] ?? '');
    if ($templatePath === '' || !is_readable($templatePath)) {
        throw new RuntimeException('Шаблон .btw не найден');
    }

    $filename = nameplate_generated_basename($context['serial'], $context['kind']);
    $destPath = nameplate_generated_dir() . '/' . $filename;

    if (!copy($templatePath, $destPath)) {
        throw new RuntimeException('Не удалось скопировать шаблон .btw');
    }

    nameplate_patch_btw_metadata_title($destPath, $context['serial']);

    $fields = is_array($job['fields'] ?? null) ? $job['fields'] : [];
    $fieldsFilename = preg_replace('/\.btw$/', '.fields.json', $filename) ?? ($filename . '.fields.json');
    $fieldsPath = nameplate_generated_dir() . '/' . $fieldsFilename;
    file_put_contents($fieldsPath, json_encode([
        'serial' => $context['serial'],
        'kind' => $context['kind'],
        'orderNumber' => $context['orderNumber'],
        'productTitle' => $context['productTitle'],
        'fields' => $fields,
        'generatedAt' => gmdate('c'),
        'sourceTemplate' => basename($templatePath),
        'filled' => false,
        'note' => 'Для генерации нужен исходный .btw в BarTender или скрипт generate-btw через Windows-хост.',
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

    $btxmlFilename = preg_replace('/\.btw$/', '.btxml', $filename) ?? ($filename . '.btxml');
    $btxmlPath = nameplate_generated_dir() . '/' . $btxmlFilename;
    if (!empty($job['btxml']) && is_string($job['btxml'])) {
        file_put_contents($btxmlPath, $job['btxml']);
    }

    return [
        'filename' => $filename,
        'path' => $destPath,
        'size' => filesize($destPath) ?: 0,
        'filled' => false,
        'downloadUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($filename),
        'fieldsUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($fieldsFilename),
        'btxmlUrl' => is_readable($btxmlPath)
            ? '/api/nameplate-print.php?action=download&file=' . rawurlencode($btxmlFilename)
            : null,
    ];
}

function nameplate_store_filled_btw(string $filename, string $bytes): array
{
    $safe = nameplate_safe_generated_file($filename);
    if (!str_ends_with(strtolower($safe), '.btw')) {
        throw new InvalidArgumentException('Укажите файл .btw');
    }
    if ($bytes === '') {
        throw new InvalidArgumentException('Пустой файл .btw');
    }
    if (strlen($bytes) > 20 * 1024 * 1024) {
        throw new InvalidArgumentException('Файл .btw слишком большой');
    }
    if (!str_contains($bytes, 'Bar Tender Format')) {
        throw new InvalidArgumentException('Файл не похож на BarTender .btw');
    }

    $path = nameplate_generated_dir() . '/' . $safe;
    if (file_put_contents($path, $bytes) === false) {
        throw new RuntimeException('Не удалось сохранить .btw');
    }

    $fieldsPath = preg_replace('/\.btw$/', '.fields.json', $path);
    if (is_string($fieldsPath) && is_readable($fieldsPath)) {
        $meta = json_decode((string) file_get_contents($fieldsPath), true);
        if (is_array($meta)) {
            $meta['filled'] = true;
            $meta['filledAt'] = gmdate('c');
            file_put_contents($fieldsPath, json_encode($meta, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        }
    }

    return [
        'filename' => $safe,
        'path' => $path,
        'size' => filesize($path) ?: strlen($bytes),
        'filled' => true,
        'downloadUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($safe),
    ];
}

require_once __DIR__ . '/nameplate_html_raster.php';

