<?php
declare(strict_types=1);

require_once __DIR__ . '/btw_parser.php';

function nameplate_btw_corrector_template_path(): string
{
    return dirname(__DIR__, 2) . '/data/nameplate-templates/corrector-300.btw';
}

function nameplate_btw_logo_png_path(): string
{
    return dirname(__DIR__, 2) . '/data/nameplate-templates/corrector-logo.png';
}

/**
 * Build a clean «Техномер» logo PNG from the BarTender preview (top-left bbox).
 * Always regenerates when $force is true; otherwise only if the file is missing.
 */
function nameplate_btw_logo_extract_from_preview(bool $force = false): bool
{
    $logoPath = nameplate_btw_logo_png_path();
    if (!$force && is_readable($logoPath) && filesize($logoPath) > 1000) {
        return true;
    }
    if (!class_exists('Imagick') || !is_readable(nameplate_btw_corrector_template_path())) {
        return is_readable($logoPath);
    }

    $data = file_get_contents(nameplate_btw_corrector_template_path());
    if (!is_string($data) || $data === '') {
        return is_readable($logoPath);
    }

    $images = btw_extract_png_images($data);
    if (!isset($images[0]['dataUrl'])) {
        return is_readable($logoPath);
    }

    $raw = base64_decode(substr((string) $images[0]['dataUrl'], strpos((string) $images[0]['dataUrl'], ',') + 1), true);
    if (!is_string($raw) || $raw === '') {
        return is_readable($logoPath);
    }

    try {
        $im = new Imagick();
        $im->readImageBlob($raw);
        $im->trimImage(0);
        $im->setImagePage(0, 0, 0, 0);
        $w = $im->getImageWidth();
        $h = $im->getImageHeight();
        $pixels = $im->exportImagePixels(0, 0, $w, $h, 'I', Imagick::PIXEL_CHAR);
        if (!is_array($pixels)) {
            $im->destroy();

            return is_readable($logoPath);
        }

        // Interior of top-left (skip rounded frame) — full word + arc.
        $minX = $w;
        $maxX = 0;
        $minY = $h;
        $maxY = 0;
        for ($y = 14; $y < min(108, $h); $y++) {
            for ($x = 20; $x < min(340, $w); $x++) {
                if ((int) $pixels[($y * $w) + $x] < 80) {
                    $minX = min($minX, $x);
                    $maxX = max($maxX, $x);
                    $minY = min($minY, $y);
                    $maxY = max($maxY, $y);
                }
            }
        }
        if ($maxX <= $minX || $maxY <= $minY) {
            $im->destroy();

            return is_readable($logoPath);
        }

        $padL = 12;
        $padR = 12;
        $padT = 14;
        $padB = 10;
        $rw = $maxX - $minX + 1;
        $rh = $maxY - $minY + 1;
        $region = $im->getImageRegion($rw, $rh, $minX, $minY);
        $region->setImagePage(0, 0, 0, 0);

        $pad = new Imagick();
        $pad->newImage($rw + $padL + $padR, $rh + $padT + $padB, new ImagickPixel('#ffffff'));
        $pad->compositeImage($region, Imagick::COMPOSITE_OVER, $padL, $padT);
        $region->destroy();

        // Pure B/W: near-white → white, dark ink → black; drop frame sliver in TL.
        $it = $pad->getPixelIterator();
        foreach ($it as $rowY => $row) {
            foreach ($row as $colX => $pixel) {
                $c = $pixel->getColor();
                $v = ($c['r'] + $c['g'] + $c['b']) / 3.0;
                $nearTl = $colX < ($padL + 8) && $rowY < ($padT + 8);
                if ($nearTl && $v > 25) {
                    $pixel->setColor('white');
                } elseif ($v > 160) {
                    $pixel->setColor('white');
                } elseif ($v < 160) {
                    $pixel->setColor('black');
                }
            }
            $it->syncIterator();
        }

        $pad->setImageFormat('png');
        $pad->writeImage($logoPath);
        $pad->destroy();
        $im->destroy();

        return is_readable($logoPath);
    } catch (Throwable) {
        return is_readable($logoPath);
    }
}

function nameplate_btw_logo_data_url(bool $forceExtract = false): string
{
    nameplate_btw_logo_extract_from_preview($forceExtract);
    $logoPath = nameplate_btw_logo_png_path();
    if (!is_readable($logoPath)) {
        return '';
    }

    $raw = file_get_contents($logoPath);

    return is_string($raw) && $raw !== ''
        ? 'data:image/png;base64,' . base64_encode($raw)
        : '';
}

/** @return list<array<string, string>> */
function nameplate_editor_data_sources(): array
{
    $sources = [
        ['key' => 'specLine1', 'bartender' => 'SpecLine1', 'label' => 'Строка конфигурации 1'],
        ['key' => 'specLine2', 'bartender' => 'SpecLine2', 'label' => 'Строка конфигурации 2'],
        ['key' => 'specLine3', 'bartender' => 'SpecLine3', 'label' => 'Строка конфигурации 3'],
        ['key' => 'releaseLabel', 'bartender' => 'ReleaseLabel', 'label' => 'Выпуск'],
        ['key' => 'serial', 'bartender' => 'Serial', 'label' => 'Серийный номер'],
        ['key' => 'productTitleShort', 'bartender' => 'ProductTitleShort', 'label' => 'Название'],
        ['key' => 'orderNumber', 'bartender' => 'OrderNumber', 'label' => 'Номер заказа'],
        ['key' => 'manufactureDate', 'bartender' => 'ManufactureDate', 'label' => 'Дата изготовления'],
    ];

    foreach (btw_known_field_names() as $name) {
        $exists = false;
        foreach ($sources as $src) {
            if (strcasecmp($src['bartender'], $name) === 0) {
                $exists = true;
                break;
            }
        }
        if (!$exists) {
            $sources[] = [
                'key' => nameplate_editor_bartender_to_context_key($name),
                'bartender' => $name,
                'label' => $name,
            ];
        }
    }

    return $sources;
}

function nameplate_editor_bartender_to_context_key(string $bartender): string
{
    $map = [
        'Serial' => 'serial',
        'SpecLine1' => 'specLine1',
        'SpecLine2' => 'specLine2',
        'SpecLine3' => 'specLine3',
        'ReleaseLabel' => 'releaseLabel',
        'ProductTitleShort' => 'productTitleShort',
        'OrderNumber' => 'orderNumber',
        'ManufactureDate' => 'manufactureDate',
    ];
    if (isset($map[$bartender])) {
        return $map[$bartender];
    }

    return lcfirst($bartender);
}

/** @return list<array<string, mixed>> */
function nameplate_editor_static_objects(): array
{
    return [
        ['id' => 'logo', 'type' => 'static', 'name' => 'Logo', 'label' => 'Логотип Техномер', 'locked' => true],
        ['id' => 'title', 'type' => 'static', 'name' => 'ProductTitle', 'label' => 'Заголовок (из .btw)', 'locked' => true],
        ['id' => 'border', 'type' => 'static', 'name' => 'Border', 'label' => 'Рамка этикетки', 'locked' => true],
    ];
}

/** @param array<string, mixed> $document */
function nameplate_template_is_blank_canvas(array $document): bool
{
    if (($document['blankCanvas'] ?? false) === true) {
        return true;
    }
    $static = $document['staticInTemplate'] ?? null;

    return is_array($static) && $static === [];
}

/** @param array<string, mixed> $document */
function nameplate_editor_objects(array $document): array
{
    if (is_array($document['editorObjects'] ?? null) && $document['editorObjects'] !== []) {
        return array_values($document['editorObjects']);
    }

    return nameplate_editor_objects_from_dynamic($document);
}

/** @param array<string, mixed> $document */
function nameplate_editor_objects_from_dynamic(array $document): array
{
    $dynamic = is_array($document['dynamicFields'] ?? null) ? $document['dynamicFields'] : [];
    $objects = [];
    $z = 10;

    $defs = [
        'productTitleShort' => ['name' => 'ProductTitleShort', 'type' => 'text', 'dataField' => 'productTitleShort', 'bartender' => 'ProductTitleShort', 'label' => 'Название изделия', 'bold' => true],
        'specLine1' => ['name' => 'SpecLine1', 'type' => 'text', 'dataField' => 'specLine1', 'bartender' => 'SpecLine1', 'label' => 'Строка конфигурации 1'],
        'specLine2' => ['name' => 'SpecLine2', 'type' => 'text', 'dataField' => 'specLine2', 'bartender' => 'SpecLine2', 'label' => 'Строка конфигурации 2'],
        'specLine3' => ['name' => 'SpecLine3', 'type' => 'text', 'dataField' => 'specLine3', 'bartender' => 'SpecLine3', 'label' => 'Строка конфигурации 3'],
        'releaseLabel' => ['name' => 'ReleaseLabel', 'type' => 'text', 'dataField' => 'releaseLabel', 'bartender' => 'ReleaseLabel', 'label' => 'Выпуск'],
        'serial' => ['name' => 'Serial', 'type' => 'text', 'dataField' => 'serial', 'bartender' => 'Serial', 'label' => 'Серийный номер', 'mono' => true, 'align' => 'center'],
        'qr' => ['name' => 'QR Code', 'type' => 'qr', 'dataField' => 'serial', 'bartender' => 'Serial', 'label' => 'QR-код'],
    ];

    foreach ($defs as $id => $def) {
        if (!isset($dynamic[$id]) || !is_array($dynamic[$id])) {
            continue;
        }
        $field = $dynamic[$id];
        $obj = [
            'id' => $id,
            'type' => $def['type'],
            'name' => $def['name'],
            'label' => $def['label'],
            'dataField' => $def['dataField'],
            'bartenderField' => $def['bartender'],
            'fontPt' => (float) ($field['fontPt'] ?? $field['font'] ?? 4.2),
            'fontFamily' => !empty($def['mono']) ? 'DejaVu Sans Mono' : 'DejaVu Sans',
            'bold' => isset($field['style']) && str_contains((string) $field['style'], 'B'),
            'italic' => false,
            'align' => $def['align'] ?? 'left',
            'rotation' => (float) ($field['rotation'] ?? 0),
            'locked' => false,
            'visible' => true,
            'deletable' => false,
            'zIndex' => $z,
        ];
        if (isset($field['fontMm']) && (float) $field['fontMm'] > 0) {
            $obj['fontMm'] = (float) $field['fontMm'];
        }
        $z += 10;

        if ($def['type'] === 'qr') {
            $obj['x'] = (float) ($field['x'] ?? 746);
            $obj['y'] = (float) ($field['y'] ?? 40);
            $obj['size'] = (float) ($field['size'] ?? 249);
        } elseif ($id === 'serial') {
            $obj['centerX'] = (float) ($field['centerX'] ?? 898.5);
            $obj['y'] = (float) ($field['y'] ?? 310);
            $obj['w'] = (float) ($field['w'] ?? 305);
            $obj['mono'] = true;
        } else {
            $obj['x'] = (float) ($field['x'] ?? 52);
            $obj['y'] = (float) ($field['y'] ?? 121);
            $obj['w'] = (float) ($field['w'] ?? 680);
        }

        $objects[] = $obj;
    }

    return $objects;
}

/** @param array<string, mixed> $document */
function nameplate_editor_sync_dynamic_fields(array $document): array
{
    $objects = nameplate_editor_objects($document);
    $dynamic = is_array($document['dynamicFields'] ?? null) ? $document['dynamicFields'] : [];

    foreach ($objects as $obj) {
        if (!is_array($obj) || ($obj['visible'] ?? true) === false) {
            continue;
        }
        $id = (string) ($obj['id'] ?? '');
        if ($id === '') {
            continue;
        }
        $type = (string) ($obj['type'] ?? 'text');
        if ($type === 'qr') {
            $dynamic['qr'] = [
                'x' => (float) ($obj['x'] ?? 746),
                'y' => (float) ($obj['y'] ?? 40),
                'size' => (float) ($obj['size'] ?? 249),
            ];
            if (isset($obj['size']) && ($document['refW'] ?? 0) > 0) {
                $dynamic['qr']['sizeMm'] = round(
                    ((float) $obj['size'] / (float) $document['refW']) * (float) ($document['pageWidthMm'] ?? 58),
                    2
                );
            }
            continue;
        }
        if ($type !== 'text') {
            continue;
        }

        $row = [
            'fontPt' => (float) ($obj['fontPt'] ?? 4.2),
            'y' => (float) ($obj['y'] ?? 0),
        ];
        if (isset($obj['fontMm']) && (float) $obj['fontMm'] > 0) {
            $row['fontMm'] = (float) $obj['fontMm'];
        }
        if (!empty($obj['bold'])) {
            $row['style'] = 'B';
        }
        if (isset($obj['rotation'])) {
            $row['rotation'] = (float) $obj['rotation'];
        }
        if (isset($obj['align']) && (string) $obj['align'] === 'center') {
            $row['align'] = 'center';
        }

        if ($id === 'serial' || isset($obj['centerX'])) {
            $dynamic['serial'] = array_merge($dynamic['serial'] ?? [], $row, [
                'centerX' => (float) ($obj['centerX'] ?? 898.5),
                'w' => (float) ($obj['w'] ?? 305),
            ]);
        } elseif (in_array($id, ['productTitleShort', 'specLine1', 'specLine2', 'specLine3', 'releaseLabel'], true)) {
            $dynamic[$id] = array_merge($dynamic[$id] ?? [], $row, [
                'x' => (float) ($obj['x'] ?? 52),
                'w' => (float) ($obj['w'] ?? 680),
            ]);
        }
    }

    $document['dynamicFields'] = $dynamic;

    return $document;
}

/** @param array<string, mixed> $document */
function nameplate_editor_ensure_dynamic_object(array $document): array
{
    $dynamic = $document['dynamicFields'] ?? [];
    if (!is_array($dynamic) || array_is_list($dynamic)) {
        $document['dynamicFields'] = [];
    }

    return $document;
}

/** @return array<string, float|bool> */
function nameplate_editor_default_layout_settings(): array
{
    return [
        'marginTopMm' => 0.0,
        'marginRightMm' => 0.0,
        'marginBottomMm' => 0.0,
        'marginLeftMm' => 0.0,
        'gridStepMm' => 1.0,
        'showMarginGuides' => true,
        'snapToMargins' => false,
    ];
}

/** @param array<string, mixed> $document */
function nameplate_editor_normalize_layout_settings(array $document): array
{
    $defaults = nameplate_editor_default_layout_settings();
    $raw = $document['layoutSettings'] ?? [];
    if (!is_array($raw)) {
        $raw = [];
    }
    $out = [];
    foreach ($defaults as $key => $default) {
        if ($key === 'showMarginGuides' || $key === 'snapToMargins') {
            $out[$key] = (bool) ($raw[$key] ?? $default);
        } elseif ($key === 'gridStepMm') {
            $out[$key] = max(0.1, min(10.0, (float) ($raw[$key] ?? $default)));
        } else {
            $out[$key] = max(0.0, min(50.0, (float) ($raw[$key] ?? $default)));
        }
    }
    $document['layoutSettings'] = $out;

    return $document;
}

/** @param array<string, mixed> $document */
function nameplate_editor_normalize_document(array $document): array
{
    $document = nameplate_editor_ensure_dynamic_object($document);
    if (!is_array($document['editorObjects'] ?? null) || $document['editorObjects'] === []) {
        $document['editorObjects'] = nameplate_editor_objects_from_dynamic($document);
    }
    $ver = (int) ($document['editorVersion'] ?? 2);
    $document['editorVersion'] = max(2, $ver);
    $document = nameplate_editor_normalize_layout_settings($document);
    $document = nameplate_editor_sync_dynamic_fields($document);

    return $document;
}

/** @param array<string, mixed> $object */
function nameplate_editor_object_text(array $object, array $context): string
{
    if (isset($object['fixedText']) && trim((string) $object['fixedText']) !== '') {
        return (string) $object['fixedText'];
    }

    $field = (string) ($object['dataField'] ?? $object['id'] ?? '');
    if ($field === 'qr') {
        return (string) ($context['serial'] ?? '');
    }

    return (string) ($context[$field] ?? '');
}

/** @param list<array<string, mixed>> $objects */
function nameplate_editor_sorted_objects(array $objects): array
{
    $copy = array_values($objects);
    usort($copy, static function (array $a, array $b): int {
        return ((int) ($a['zIndex'] ?? 0)) <=> ((int) ($b['zIndex'] ?? 0));
    });

    return $copy;
}

/** @param array<string, mixed> $document @return list<array<string, int>> */
function nameplate_editor_dynamic_masks(array $document): array
{
    $refW = (int) ($document['refW'] ?? 1052);
    $refH = (int) ($document['refH'] ?? 364);
    $masks = [];
    foreach (nameplate_editor_objects($document) as $obj) {
        if (!is_array($obj) || ($obj['visible'] ?? true) === false) {
            continue;
        }
        $type = (string) ($obj['type'] ?? '');
        if ($type === 'static') {
            continue;
        }
        if ($type === 'qr') {
            $size = (int) ($obj['size'] ?? 249);
            $masks[] = [
                'x1' => max(0, (int) ($obj['x'] ?? 746) - 4),
                'y1' => max(0, (int) ($obj['y'] ?? 40) - 4),
                'x2' => min($refW - 1, (int) ($obj['x'] ?? 746) + $size + 4),
                'y2' => min($refH - 1, (int) ($obj['y'] ?? 40) + $size + 4),
            ];
            continue;
        }
        if ($type === 'image') {
            $x = (int) ($obj['x'] ?? 0);
            $y = (int) ($obj['y'] ?? 0);
            $w = (int) ($obj['w'] ?? 100);
            $h = (int) ($obj['h'] ?? 100);
            $masks[] = [
                'x1' => max(0, $x - 4),
                'y1' => max(0, $y - 4),
                'x2' => min($refW - 1, $x + $w + 4),
                'y2' => min($refH - 1, $y + $h + 4),
            ];
            continue;
        }
        $h = (int) max(24, (($obj['fontPt'] ?? 4.2) * 0.352778 * ((float) ($document['refH'] ?? 364) / (float) ($document['pageHeightMm'] ?? 20))) * 1.2);
        if (isset($obj['centerX'])) {
            $w = (int) ($obj['w'] ?? 305);
            $cx = (int) ($obj['centerX'] ?? 898);
            $masks[] = ['x1' => max(0, $cx - $w / 2 - 4), 'y1' => max(0, (int) ($obj['y'] ?? 0) - 2), 'x2' => min($refW - 1, $cx + $w / 2 + 4), 'y2' => min($refH - 1, (int) ($obj['y'] ?? 0) + $h + 4)];
        } else {
            $x = (int) ($obj['x'] ?? 0);
            $w = min((int) ($obj['w'] ?? 680), max(40, $refW - $x - 8));
            $masks[] = [
                'x1' => max(0, $x - 4),
                'y1' => max(0, (int) ($obj['y'] ?? 0) - 2),
                'x2' => min($refW - 1, $x + $w + 4),
                'y2' => min($refH - 1, (int) ($obj['y'] ?? 0) + $h + 4),
            ];
        }
    }

    $normalized = [];
    foreach ($masks as $mask) {
        $x1 = max(0, min($refW - 1, (int) ($mask['x1'] ?? 0)));
        $y1 = max(0, min($refH - 1, (int) ($mask['y1'] ?? 0)));
        $x2 = max(0, min($refW - 1, (int) ($mask['x2'] ?? 0)));
        $y2 = max(0, min($refH - 1, (int) ($mask['y2'] ?? 0)));
        if ($x2 <= $x1 || $y2 <= $y1) {
            continue;
        }
        $normalized[] = ['x1' => $x1, 'y1' => $y1, 'x2' => $x2, 'y2' => $y2];
    }

    return $normalized;
}

/** @return array{refW: int, refH: int} */
function nameplate_editor_ref_dimensions(float $pageWidthMm, float $pageHeightMm): array
{
    return [
        'refW' => max(100, (int) round($pageWidthMm * (1052 / 58))),
        'refH' => max(100, (int) round($pageHeightMm * (364 / 20))),
    ];
}

/** @return array<string, mixed> */
function nameplate_editor_scratch_document(string $kind = 'corrector'): array
{
    $k = strtolower(trim($kind));
    $productKind = ($k === 'complex' || $k === '400') ? 'complex' : 'corrector';

    return [
        'referenceDrawing' => '',
        'referenceTemplate' => '',
        'pageWidthMm' => 58,
        'pageHeightMm' => 20,
        'refW' => 1052,
        'refH' => 364,
        'staticInTemplate' => [],
        'productKind' => $productKind,
        'blankCanvas' => true,
        'layoutSettings' => nameplate_editor_default_layout_settings(),
        'dynamicFields' => [],
        'editorObjects' => [],
        'editorVersion' => 2,
    ];
}

/** @return array<string, mixed> */
function nameplate_editor_blank_document(string $kind = 'corrector'): array
{
    $k = strtolower(trim($kind));
    $productKind = ($k === 'complex' || $k === '400') ? 'complex' : 'corrector';

    return [
        'referenceDrawing' => "\u0422\u041c\u0420.754463.091",
        'referenceTemplate' => 'corrector-300.btw',
        'pageWidthMm' => 58,
        'pageHeightMm' => 20,
        'refW' => 1052,
        'refH' => 364,
        'staticInTemplate' => ['logo', 'title', 'border'],
        'productKind' => $productKind,
        'dynamicFields' => [],
    ];
}

/** @return array<string, mixed> */
function nameplate_editor_document_from_layout_default(): array
{
    require_once __DIR__ . '/nameplate_pdf.php';
    $layout = nameplate_pdf_corrector_layout_default();
    $specKeys = ['specLine1', 'specLine2', 'specLine3'];
    $dynamic = [];
    foreach ($layout['specLines'] as $i => $line) {
        $dynamic[$specKeys[$i]] = [
            'x' => (float) $line['x'],
            'y' => (float) $line['y'],
            'fontPt' => (float) $line['font'],
            'w' => (float) $line['w'],
        ];
    }
    $rel = $layout['release'];
    $dynamic['releaseLabel'] = [
        'x' => (float) $rel['x'],
        'y' => (float) $rel['y'],
        'fontPt' => (float) $rel['font'],
        'w' => (float) $rel['w'],
    ];
    $ser = $layout['serial'];
    $dynamic['serial'] = [
        'centerX' => (float) $ser['centerX'],
        'y' => (float) $ser['y'],
        'fontPt' => (float) $ser['font'],
        'w' => (float) $ser['w'],
        'style' => (string) ($ser['style'] ?? ''),
    ];
    $qr = $layout['qr'];
    $dynamic['qr'] = [
        'x' => (float) $qr['x'],
        'y' => (float) $qr['y'],
        'size' => (float) $qr['size'],
        'sizeMm' => round(((float) $qr['size']) / 1052 * 58, 2),
    ];
    $doc = nameplate_editor_blank_document();
    $doc['dynamicFields'] = $dynamic;

    return nameplate_editor_normalize_document($doc);
}

/** @param array<string, mixed> $document */
function nameplate_editor_clear_document(array $document): array
{
    $document['dynamicFields'] = [];
    $document['editorObjects'] = [];
    $document['editorVersion'] = 2;

    return $document;
}

/** @param mixed $value */
function nameplate_editor_sanitize_utf8(mixed $value): mixed
{
    if (is_array($value)) {
        foreach ($value as $k => $v) {
            $value[$k] = nameplate_editor_sanitize_utf8($v);
        }

        return $value;
    }
    if (!is_string($value)) {
        return $value;
    }
    if (mb_check_encoding($value, 'UTF-8')) {
        return $value;
    }

    return mb_convert_encoding($value, 'UTF-8', 'UTF-8');
}

/** @param array<string, mixed> $document @return array<string, mixed> */
function nameplate_document_for_json_encode(array $document): array
{
    $copy = $document;
    if (($copy['dynamicFields'] ?? null) === []) {
        $copy['dynamicFields'] = new stdClass();
    }

    return $copy;
}
