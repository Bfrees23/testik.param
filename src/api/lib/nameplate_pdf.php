<?php
declare(strict_types=1);

function nameplate_pdf_autoload(): void
{
    static $loaded = false;
    if ($loaded) {
        return;
    }
    $autoload = dirname(__DIR__, 2) . '/vendor/autoload.php';
    if (!is_readable($autoload)) {
        throw new RuntimeException('Composer vendor не найден. Выполните: composer install -d src');
    }
    require_once $autoload;
    $loaded = true;
}

function nameplate_pdf_page_size(?array $config = null): array
{
    $cfg = $config ?? nameplate_load_config();
    $html = is_array($cfg['html'] ?? null) ? $cfg['html'] : [];

    return [
        (float) ($html['pageWidthMm'] ?? 58),
        (float) ($html['pageHeightMm'] ?? 20),
    ];
}

function nameplate_pdf_filename(string $serial, string $kind): string
{
    $serial = trim($serial);
    $kind = strtolower(trim($kind));
    if (!preg_match('/^\d{10}$/', $serial)) {
        throw new InvalidArgumentException('serial: 10 цифр');
    }
    if ($kind !== 'corrector' && $kind !== 'complex') {
        throw new InvalidArgumentException('kind: corrector или complex');
    }

    return $serial . '-' . $kind . '.pdf';
}

function nameplate_pdf_static_image_path(string $kind): ?string
{
    $kindKey = strtolower(trim($kind));
    if ($kindKey === 'corrector' || $kindKey === '300') {
        $path = nameplate_templates_dir() . '/corrector-nameplate-static.png';
        return is_readable($path) ? $path : null;
    }

    return null;
}

function nameplate_pdf_use_template(?array $config = null): bool
{
    $cfg = $config ?? nameplate_load_config();
    $pdfCfg = is_array($cfg['pdf'] ?? null) ? $cfg['pdf'] : [];

    return (bool) ($pdfCfg['useTemplate'] ?? true);
}

function nameplate_pdf_template_path(string $kind, ?array $config = null): ?string
{
    if (!nameplate_pdf_use_template($config)) {
        return null;
    }

    $cfg = $config ?? nameplate_load_config();
    $pdfCfg = is_array($cfg['pdf'] ?? null) ? $cfg['pdf'] : [];
    $kindKey = strtolower(trim($kind));

    $file = match ($kindKey) {
        'corrector', '300' => (string) ($pdfCfg['templateCorrector'] ?? 'corrector-nameplate-template.pdf'),
        default => '',
    };
    if ($file === '') {
        return null;
    }

    $path = nameplate_templates_dir() . '/' . basename($file);

    return is_readable($path) ? $path : null;
}

function nameplate_pdf_init_document(float $widthMm, float $heightMm, ?string $templatePath = null): \TCPDF
{
    if ($templatePath !== null && is_readable($templatePath)) {
        $pdf = new \setasign\Fpdi\Tcpdf\Fpdi('L', 'mm', [$widthMm, $heightMm], true, 'UTF-8', false);
    $pdf->setPrintHeader(false);
    $pdf->setPrintFooter(false);
    $pdf->SetMargins(0, 0, 0);
    $pdf->SetAutoPageBreak(false, 0);
        $pdf->setSourceFile($templatePath);
    $pdf->AddPage();
        $tplId = $pdf->importPage(1);
        $pdf->useTemplate($tplId, 0, 0, $widthMm, $heightMm);

        return $pdf;
    }

    $pdf = new \TCPDF('L', 'mm', [$widthMm, $heightMm], true, 'UTF-8', false);
    $pdf->setPrintHeader(false);
    $pdf->setPrintFooter(false);
    $pdf->SetMargins(0, 0, 0);
    $pdf->SetAutoPageBreak(false, 0);
    $pdf->AddPage();

    return $pdf;
}

/** @param array{x:float,y:float,font:float,w:float} $spec */
function nameplate_pdf_draw_text_field(
    \TCPDF $pdf,
    array $spec,
    string $text,
    float $refW,
    float $refH,
    float $widthMm,
    float $heightMm,
    string $fontFamily = 'dejavusans',
    string $fontStyle = '',
    float $lineHeightPx = 26.0
): void {
    if ($text === '') {
        return;
    }

    $xMm = nameplate_pdf_px_to_mm((float) $spec['x'], $refW, $widthMm);
    $yMm = nameplate_pdf_px_to_mm((float) $spec['y'], $refH, $heightMm);
    $wMm = nameplate_pdf_px_to_mm((float) $spec['w'], $refW, $widthMm);
    $fontPt = nameplate_pdf_font_pt_from_spec($spec);
    $style = array_key_exists('style', $spec) ? (string) $spec['style'] : $fontStyle;
    $hMm = nameplate_pdf_px_to_mm($lineHeightPx, $refH, $heightMm);

    $pdf->SetFont($fontFamily, $style, $fontPt);
    $pdf->SetXY($xMm, $yMm);
    $pdf->Cell($wMm, $hMm, $text, 0, 0, 'L', false, '', 0, false, true, 'T');
}

/** @var array<string, mixed>|null */
$GLOBALS['nameplate_fields_override'] = null;

/** @param array<string, mixed>|null $document */
function nameplate_pdf_set_fields_override(?array $document): void
{
    $GLOBALS['nameplate_fields_override'] = $document;
}

function nameplate_pdf_clear_fields_override(): void
{
    $GLOBALS['nameplate_fields_override'] = null;
}

/** Positions and font sizes calibrated from corrector-300.btw preview (1052×364 px, 58×20 mm). */
function nameplate_pdf_corrector_layout(): array
{
    $override = $GLOBALS['nameplate_fields_override'] ?? null;
    if (is_array($override)) {
        return nameplate_pdf_corrector_layout_from_fields($override);
    }

    $fieldsPath = nameplate_templates_dir() . '/corrector-nameplate-template.fields.json';
    if (is_readable($fieldsPath)) {
        $raw = file_get_contents($fieldsPath);
        if (is_string($raw) && $raw !== '') {
            $fields = json_decode($raw, true);
            if (is_array($fields)) {
                return nameplate_pdf_corrector_layout_from_fields($fields);
            }
        }
    }

    return nameplate_pdf_corrector_layout_default();
}

/** @param array<string, mixed> $fields */
function nameplate_pdf_corrector_layout_from_fields(array $fields): array
{
    $refW = (float) ($fields['refW'] ?? 1052);
    $refH = (float) ($fields['refH'] ?? 364);
    $dynamic = is_array($fields['dynamicFields'] ?? null) ? $fields['dynamicFields'] : [];

    $specLines = [];
    foreach (['specLine1', 'specLine2', 'specLine3'] as $key) {
        if (!isset($dynamic[$key]) || !is_array($dynamic[$key])) {
            continue;
        }
        $specLines[] = nameplate_pdf_layout_field_to_spec($dynamic[$key], $refW, $refH, (float) ($fields['pageHeightMm'] ?? 20));
    }

    $layout = [
        'refW' => $refW,
        'refH' => $refH,
        'specLines' => $specLines,
        'release' => nameplate_pdf_layout_field_to_spec(
            is_array($dynamic['releaseLabel'] ?? null) ? $dynamic['releaseLabel'] : [],
            $refW,
            $refH,
            (float) ($fields['pageHeightMm'] ?? 20)
        ),
        'qr' => nameplate_pdf_layout_qr_spec(
            is_array($dynamic['qr'] ?? null) ? $dynamic['qr'] : [],
            $refW,
            (float) ($fields['pageWidthMm'] ?? 58)
        ),
        'serial' => nameplate_pdf_layout_serial_spec(
            is_array($dynamic['serial'] ?? null) ? $dynamic['serial'] : [],
            $refW,
            $refH,
            (float) ($fields['pageHeightMm'] ?? 20)
        ),
    ];
    if (isset($dynamic['productTitleShort']) && is_array($dynamic['productTitleShort'])) {
        $layout['title'] = nameplate_pdf_layout_field_to_spec(
            $dynamic['productTitleShort'],
            $refW,
            $refH,
            (float) ($fields['pageHeightMm'] ?? 20)
        );
    }

    return $layout;
}

/** White-out rectangles for dynamic fields — pixel bands from corrector-300.btw preview (1052×364). */
function nameplate_pdf_corrector_dynamic_masks(int $width): array
{
    $textRight = min($width - 8, 742);

    return [
        ['x1' => 28, 'y1' => 121, 'x2' => $textRight, 'y2' => 162],
        ['x1' => 28, 'y1' => 191, 'x2' => $textRight, 'y2' => 218],
        ['x1' => 28, 'y1' => 262, 'x2' => $textRight, 'y2' => 289],
        ['x1' => 28, 'y1' => 310, 'x2' => 430, 'y2' => 334],
        ['x1' => 746, 'y1' => 35, 'x2' => $width - 6, 'y2' => 338],
    ];
}

/** Darken light-gray BarTender preview text so TSPL prints it black (title stays from raster). */
function nameplate_pdf_darken_gray_ink(Imagick $im, int $x1, int $y1, int $x2, int $y2, int $threshold = 235): void
{
    $black = new ImagickPixel('#000000');
    for ($y = $y1; $y <= $y2; $y++) {
        for ($x = $x1; $x <= $x2; $x++) {
            $r = (int) ($im->getImagePixelColor($x, $y)->getColor()['r'] ?? 255);
            if ($r > 0 && $r < $threshold) {
                $im->setImagePixelColor($x, $y, $black);
            }
        }
    }
}

function nameplate_pdf_corrector_layout_default(): array
{
    return [
        'refW' => 1052,
        'refH' => 364,
        'title' => ['x' => 52, 'y' => 58, 'font' => 6.5, 'w' => 680, 'style' => 'B'],
        'specLines' => [
            ['x' => 52, 'y' => 121, 'font' => 5.7, 'w' => 717],
            ['x' => 50, 'y' => 191, 'font' => 4.2, 'w' => 495],
            ['x' => 51, 'y' => 262, 'font' => 4.2, 'w' => 729],
        ],
        'release' => ['x' => 51, 'y' => 310, 'font' => 3.7, 'w' => 758],
        'qr' => ['x' => 746, 'y' => 40, 'size' => 249],
        'serial' => ['centerX' => 898.5, 'y' => 310, 'font' => 3.6, 'w' => 305, 'style' => ''],
    ];
}

/** @param array<string, mixed> $field */
function nameplate_pdf_layout_field_to_spec(array $field, float $refW, float $refH, float $pageHeightMm): array
{
    $spec = [
        'x' => (float) ($field['x'] ?? 52),
        'y' => (float) ($field['y'] ?? 0),
        'w' => (float) ($field['w'] ?? 680),
    ];
    if (isset($field['style']) && is_string($field['style'])) {
        $spec['style'] = $field['style'];
    }
    if (isset($field['fontMm'])) {
        $spec['fontMm'] = (float) $field['fontMm'];
    } elseif (isset($field['fontPt'])) {
        $spec['font'] = (float) $field['fontPt'];
    } elseif (isset($field['font'])) {
        $spec['font'] = (float) $field['font'];
    } else {
        $spec['font'] = 4.2;
    }

    return $spec;
}

/** @param array<string, mixed> $field */
function nameplate_pdf_layout_qr_spec(array $field, float $refW, float $pageWidthMm): array
{
    if (isset($field['sizeMm'])) {
        $sizePx = ((float) $field['sizeMm']) * ($refW / $pageWidthMm);

        return [
            'x' => (float) ($field['x'] ?? 746),
            'y' => (float) ($field['y'] ?? 40),
            'size' => $sizePx,
            'sizeMm' => (float) $field['sizeMm'],
        ];
    }

    return [
        'x' => (float) ($field['x'] ?? 746),
        'y' => (float) ($field['y'] ?? 40),
        'size' => (float) ($field['size'] ?? 249),
    ];
}

/** @param array<string, mixed> $field */
function nameplate_pdf_layout_serial_spec(array $field, float $refW, float $refH, float $pageHeightMm): array
{
    $spec = [
        'centerX' => (float) ($field['centerX'] ?? 898.5),
        'y' => (float) ($field['y'] ?? 310),
        'w' => (float) ($field['w'] ?? 305),
        'style' => (string) ($field['style'] ?? ''),
    ];
    if (isset($field['rotation'])) {
        $spec['rotation'] = (float) $field['rotation'];
    }
    if (isset($field['fontMm'])) {
        $spec['fontMm'] = (float) $field['fontMm'];
    } else {
        $spec['font'] = (float) ($field['font'] ?? 3.7);
    }

    return $spec;
}

function nameplate_pdf_mm_font_pt(float $heightMm): float
{
    return max(4.0, $heightMm / 0.352778);
}

function nameplate_pdf_font_metrics_canvas(): Imagick
{
    static $canvas = null;
    if ($canvas instanceof Imagick) {
        return $canvas;
    }

    $canvas = new Imagick();
    $canvas->newImage(1200, 400, new ImagickPixel('#ffffff'));
    $canvas->setImageFormat('png');

    return $canvas;
}

function nameplate_pdf_font_ascender_px(float $fontPx, string $fontPath, Imagick $canvas): float
{
    $draw = new ImagickDraw();
    $draw->setFont($fontPath);
    $draw->setFontSize($fontPx);
    $metrics = $canvas->queryFontMetrics($draw, 'AyАБВ', false);

    return (float) ($metrics['ascender'] ?? ($fontPx * 0.85));
}

/** GOST drawing font height (mm) -> Imagick font size for matching cap height. */
function nameplate_pdf_font_px_for_cap_mm(
    float $fontMm,
    float $refH,
    float $pageHeightMm,
    string $fontPath
): float {
    if ($fontMm <= 0 || $pageHeightMm <= 0 || $refH <= 0) {
        return 12.0;
    }

    $targetCapPx = ($fontMm / $pageHeightMm) * $refH;
    $canvas = nameplate_pdf_font_metrics_canvas();
    $lo = 1.0;
    $hi = max(24.0, $targetCapPx * 3.0);

    for ($i = 0; $i < 32; $i++) {
        $mid = ($lo + $hi) / 2.0;
        $asc = nameplate_pdf_font_ascender_px($mid, $fontPath, $canvas);
        if ($asc < $targetCapPx) {
            $lo = $mid;
        } else {
            $hi = $mid;
        }
    }

    return max(4.0, $hi);
}

function nameplate_pdf_y_top_from_baseline_mm(
    float $baselineMm,
    float $fontPx,
    string $fontPath,
    float $refH,
    float $pageHeightMm
): float {
    if ($pageHeightMm <= 0 || $refH <= 0) {
        return 0.0;
    }

    $baselinePx = ($baselineMm / $pageHeightMm) * $refH;
    $asc = nameplate_pdf_font_ascender_px($fontPx, $fontPath, nameplate_pdf_font_metrics_canvas());

    return max(0.0, $baselinePx - $asc);
}

function nameplate_pdf_font_path_for_object(array $obj, string $defaultPath): string
{
    if (!empty($obj['mono'])) {
        $mono = preg_replace('/DejaVuSans\.ttf$/', 'DejaVuSansMono-Bold.ttf', $defaultPath);
        if (is_string($mono) && is_readable($mono)) {
            return $mono;
        }
    }
    if (!empty($obj['bold'])) {
        $bold = preg_replace('/DejaVuSans\.ttf$/', 'DejaVuSans-Bold.ttf', $defaultPath);
        if (is_string($bold) && is_readable($bold)) {
            return $bold;
        }
    }

    return $defaultPath;
}

function nameplate_pdf_font_px_for_object(
    array $obj,
    float $refH,
    float $pageHeightMm,
    string $fontPath
): float {
    $path = nameplate_pdf_font_path_for_object($obj, $fontPath);
    if (isset($obj['fontMm']) && (float) $obj['fontMm'] > 0) {
        return nameplate_pdf_font_px_for_cap_mm((float) $obj['fontMm'], $refH, $pageHeightMm, $path);
    }

    return nameplate_pdf_font_size_px((float) ($obj['fontPt'] ?? 4.2), $refH, $pageHeightMm);
}

function nameplate_pdf_font_pt_for_object(
    array $obj,
    float $refH,
    float $pageHeightMm,
    string $fontPath
): float {
    if (isset($obj['fontMm']) && (float) $obj['fontMm'] > 0) {
        $fontPx = nameplate_pdf_font_px_for_object($obj, $refH, $pageHeightMm, $fontPath);
        if ($pageHeightMm <= 0 || $refH <= 0) {
            return max(4.0, (float) $obj['fontMm'] / 0.352778);
        }

        return max(4.0, round($fontPx / ($refH / $pageHeightMm) / 0.352778, 2));
    }

    return max(4.0, (float) ($obj['fontPt'] ?? 4.2));
}

/** @param array<string, float|string> $spec */
function nameplate_pdf_font_pt_from_spec(array $spec): float
{
    if (isset($spec['fontMm'])) {
        return nameplate_pdf_mm_font_pt((float) $spec['fontMm']);
    }

    return (float) ($spec['font'] ?? 6.0);
}

/** @param array<string, float|int> $qr */
function nameplate_pdf_qr_size_mm(array $qr, float $refW, float $widthMm): float
{
    if (isset($qr['sizeMm'])) {
        return (float) $qr['sizeMm'];
    }

    return nameplate_pdf_px_to_mm((float) $qr['size'], $refW, $widthMm);
}

function nameplate_pdf_btw_preview_png_path(): ?string
{
    $path = nameplate_templates_dir() . '/extracted/png1.png';
    if (is_readable($path)) {
        return $path;
    }

    $btwPath = nameplate_templates_dir() . '/corrector-300.btw';
    if (!is_readable($btwPath)) {
        return null;
    }

    require_once __DIR__ . '/btw_parser.php';
    $data = file_get_contents($btwPath);
    if ($data === false) {
        return null;
    }
    $parsed = btw_parse_bytes($data, 'corrector-300.btw');
    if (($parsed['embeddedImages'][0]['dataUrl'] ?? '') === '') {
        return null;
    }
    $png = base64_decode(substr((string) $parsed['embeddedImages'][0]['dataUrl'], strpos((string) $parsed['embeddedImages'][0]['dataUrl'], ',') + 1), true);
    if (!is_string($png) || $png === '') {
        return null;
    }

    $dir = dirname($path);
    if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
        return null;
    }
    file_put_contents($path, $png);

    return is_readable($path) ? $path : null;
}

function nameplate_pdf_prepare_corrector_base_image(): Imagick
{
    require_once __DIR__ . '/nameplate_template_editor.php';
    $srcPath = nameplate_pdf_btw_preview_png_path();
    if ($srcPath === null) {
        $fallback = nameplate_pdf_static_image_path('corrector');
        if ($fallback === null) {
            throw new RuntimeException('BarTender preview PNG not found');
        }
        $srcPath = $fallback;
    }

    $im = new Imagick($srcPath);
    if (basename($srcPath) === 'png1.png') {
        $im->trimImage(0);
    }
    $im->setImageType(Imagick::IMGTYPE_TRUECOLOR);
    $im->setImageAlphaChannel(Imagick::ALPHACHANNEL_DEACTIVATE);

    $w = $im->getImageWidth();
    $draw = new ImagickDraw();
    $draw->setFillColor('white');
    $draw->setStrokeColor('white');
    $fieldsDoc = $GLOBALS['nameplate_fields_override'] ?? null;
    $masks = is_array($fieldsDoc)
        ? nameplate_editor_dynamic_masks($fieldsDoc)
        : nameplate_pdf_corrector_dynamic_masks($w);
    foreach ($masks as $mask) {
        $draw->rectangle((int) $mask['x1'], (int) $mask['y1'], (int) $mask['x2'], (int) $mask['y2']);
    }
    $im->drawImage($draw);
    nameplate_pdf_darken_gray_ink($im, 48, 53, (int) ($w * 0.72), 98);
    nameplate_pdf_strip_preview_border($im);

    return $im;
}

/** @return array{x1: int, y1: int, x2: int, y2: int} */
function nameplate_pdf_logo_preserve_rect(int $w, int $h): array
{
    return [
        'x1' => 0,
        'y1' => 0,
        'x2' => min($w - 1, (int) round($w * 0.24)),
        'y2' => min($h - 1, (int) round($h * 0.36)),
    ];
}

/** Remove gray rounded frame from BarTender preview — only corner/border pixels, not content. */
function nameplate_pdf_strip_preview_border(Imagick $im): void
{
    $w = $im->getImageWidth();
    $h = $im->getImageHeight();
    $scale = max(0.25, $h / 364.0);
    $margin = max(1, (int) round(14 * $scale));
    $edge = max(1, (int) round(18 * $scale));
    $white = new ImagickPixel('#ffffff');
    $logo = nameplate_pdf_logo_preserve_rect($w, $h);

    for ($y = 0; $y < $h; $y++) {
        for ($x = 0; $x < $w; $x++) {
            if ($x >= $logo['x1'] && $x <= $logo['x2'] && $y >= $logo['y1'] && $y <= $logo['y2']) {
                continue;
            }
            if ($x >= $margin && $x < $w - $margin && $y >= $margin && $y < $h - $margin) {
                continue;
            }
            $r = (int) ($im->getImagePixelColor($x, $y)->getColor()['r'] ?? 255);
            if ($r >= 85 && $r <= 210) {
                $im->setImagePixelColor($x, $y, $white);
            } elseif ($r < 85 && ($x < $edge || $x >= $w - $edge || $y < $edge || $y >= $h - $edge)) {
                $im->setImagePixelColor($x, $y, $white);
            }
        }
    }
}

function nameplate_pdf_px_to_mm(float $px, float $ref, float $pageMm): float
{
    return $px / $ref * $pageMm;
}

function nameplate_pdf_trim(string $text, int $maxLen): string
{
    $text = trim($text);
    if ($text === '') {
        return '';
    }
    if (mb_strlen($text, 'UTF-8') <= $maxLen) {
        return $text;
    }

    return mb_substr($text, 0, $maxLen - 1, 'UTF-8') . '…';
}

function nameplate_pdf_font_path(): string
{
    $candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/dejavu/DejaVuSans.ttf',
    ];
    foreach ($candidates as $path) {
        if (is_readable($path)) {
            return $path;
        }
    }

    throw new RuntimeException('DejaVu Sans font not found for Imagick');
}

function nameplate_pdf_font_size_px(float $fontPt, float $refH = 364.0, float $pageHeightMm = 20.0): float
{
    if ($pageHeightMm <= 0) {
        return max(8.0, $fontPt * 3.6);
    }

    return max(8.0, $fontPt * 0.352778 * ($refH / $pageHeightMm));
}

function nameplate_pdf_font_size_px_from_spec(array $spec, float $refH = 364.0, float $pageHeightMm = 20.0): float
{
    return nameplate_pdf_font_size_px(nameplate_pdf_font_pt_from_spec($spec), $refH, $pageHeightMm);
}

/** Shrink fontPx until text fits maxWidthPx (keeps bold specs out of QR zone). */
function nameplate_pdf_fit_font_px_to_width(
    string $text,
    float $fontPx,
    string $fontPath,
    float $maxWidthPx,
    float $strokePadPx = 0.0,
    float $minRatio = 0.0
): float {
    if ($text === '' || $maxWidthPx <= 0) {
        return $fontPx;
    }
    // Leave room for thermal stroke / antialias bleed past metrics width.
    $budget = max(8.0, $maxWidthPx - max(0.0, $strokePadPx));
    $canvas = nameplate_pdf_font_metrics_canvas();
    $draw = new ImagickDraw();
    $draw->setFont($fontPath);
    $floor = max(8.0, $minRatio > 0.0 ? ($fontPx * $minRatio) : 8.0);
    $lo = $floor;
    $hi = $fontPx;
    for ($i = 0; $i < 28; $i++) {
        $mid = ($lo + $hi) / 2.0;
        $draw->setFontSize($mid);
        $w = (float) ($canvas->queryFontMetrics($draw, $text, false)['textWidth'] ?? 0);
        if ($w <= $budget) {
            $lo = $mid;
        } else {
            $hi = $mid;
        }
    }
    $draw->setFontSize($lo);
    $w = (float) ($canvas->queryFontMetrics($draw, $text, false)['textWidth'] ?? 0);
    if ($w > $budget) {
        // Still overflows at floor — keep floor (wrap should have balanced lines).
        return $floor;
    }

    return max($floor, $lo);
}

/** @return list<string> */
function nameplate_pdf_wrap_text_to_width(string $text, float $fontPx, string $fontPath, float $maxWidthPx): array
{
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    $chunks = preg_split("/\n/u", $text) ?: [$text];
    $canvas = nameplate_pdf_font_metrics_canvas();
    $draw = new ImagickDraw();
    $draw->setFont($fontPath);
    $draw->setFontSize(max(4.0, $fontPx));
    $out = [];
    foreach ($chunks as $chunk) {
        $words = preg_split('/\s+/u', trim((string) $chunk)) ?: [];
        if ($words === [] || ($words[0] ?? '') === '') {
            $out[] = '';
            continue;
        }
        $line = '';
        foreach ($words as $word) {
            $trial = $line === '' ? $word : ($line . ' ' . $word);
            $w = (float) ($canvas->queryFontMetrics($draw, $trial, false)['textWidth'] ?? 0);
            if ($w <= $maxWidthPx || $line === '') {
                $line = $trial;
            } else {
                $out[] = $line;
                $line = $word;
            }
        }
        if ($line !== '') {
            $out[] = $line;
        }
    }

    return $out !== [] ? $out : [''];
}

function nameplate_pdf_composite_text(
    Imagick $base,
    string $text,
    float $x,
    float $y,
    float $fontPx,
    string $fontPath,
    int $align = Imagick::ALIGN_LEFT,
    ?float $centerX = null,
    float $rotation = 0.0,
    bool $thermalStroke = false
): void {
    nameplate_pdf_draw_text_at_ink_top(
        $base,
        $text,
        $x,
        $y,
        $fontPx,
        $fontPath,
        $align,
        $centerX,
        $rotation,
        $thermalStroke
    );
}

/** Draw text with y = top ink row (BarTender preview band yPx), matching TCPDF Cell valign top. */
function nameplate_pdf_draw_text_at_ink_top(
    Imagick $base,
    string $text,
    float $x,
    float $y,
    float $fontPx,
    string $fontPath,
    int $align = Imagick::ALIGN_LEFT,
    ?float $centerX = null,
    float $rotation = 0.0,
    bool $thermalStroke = false
): void {
    if ($text === '') {
        return;
    }

    $draw = new ImagickDraw();
    $draw->setFillColor('black');
    $draw->setFont($fontPath);
    $draw->setFontSize($fontPx);
    $draw->setTextAntialias(true);
    $draw->setTextAlignment($align);
    // Stroke thickens glyphs for 203 dpi thermal (bold + regular).
    if ($thermalStroke && $fontPx < 48.0) {
        $draw->setStrokeColor('black');
        $draw->setStrokeWidth(max(0.55, $fontPx * 0.038));
        $draw->setStrokeAntialias(true);
    }

    $metrics = $base->queryFontMetrics($draw, $text, false);
    $ascender = (float) ($metrics['ascender'] ?? $fontPx * 0.85);
    $baseline = $y + $ascender;

    // Fit to object width is handled by caller via smaller fontPt; keep annotate simple.
    if ($align === Imagick::ALIGN_CENTER && $centerX !== null) {
        $base->annotateImage($draw, $centerX, $baseline, $rotation, $text);
    } else {
        $base->annotateImage($draw, $x, $baseline, $rotation, $text);
    }
}

/** @param array<string, mixed> $obj @param array<string, string> $context */
function nameplate_pdf_composite_editor_qr(Imagick $im, array $obj, array $context): void
{
    require_once __DIR__ . '/nameplate_template_editor.php';
    require_once __DIR__ . '/nameplate_html_raster.php';

    $data = nameplate_editor_object_text($obj, $context);
    if ($data === '') {
        return;
    }

    $sizePx = (int) round((float) ($obj['size'] ?? $obj['w'] ?? 249));
    $sizePx = max(32, min(512, $sizePx));
    try {
        $raw = nameplate_qr_png_bytes($data, $sizePx);
    } catch (Throwable) {
        return;
    }

    $overlay = new Imagick();
    try {
        $overlay->readImageBlob($raw);
    } catch (Throwable) {
        $overlay->destroy();

        return;
    }
    $overlay->resizeImage($sizePx, $sizePx, Imagick::FILTER_POINT, 1, false);
    $ox = (int) round((float) ($obj['x'] ?? 0));
    $oy = (int) round((float) ($obj['y'] ?? 0));
    $im->compositeImage($overlay, Imagick::COMPOSITE_OVER, $ox, $oy);
    $overlay->destroy();
}

/** @param array<string, mixed> $obj */
function nameplate_pdf_composite_editor_image(Imagick $im, array $obj): void
{
    $data = (string) ($obj['imageData'] ?? '');
    if ($data === '' || !str_contains($data, ',')) {
        return;
    }
    $raw = base64_decode(substr($data, strpos($data, ',') + 1), true);
    if (!is_string($raw) || $raw === '') {
        return;
    }
    $overlay = new Imagick();
    try {
        $overlay->readImageBlob($raw);
    } catch (Throwable) {
        $overlay->destroy();

        return;
    }
    // Drop transparent/white padding so «Техномер» fills the reserved box.
    try {
        $overlay->trimImage(0);
        $overlay->setImagePage(0, 0, 0, 0);
    } catch (Throwable) {
        // keep original if trim fails
    }
    $targetW = max(1, (int) ($obj['w'] ?? 100));
    $targetH = max(1, (int) ($obj['h'] ?? 100));
    $fill = strtolower((string) ($obj['imageFit'] ?? 'contain'));
    if ($fill === 'height' || $fill === 'cover-height') {
        // Scale to box height, allow width up to targetW (brand mark reads larger).
        $ow0 = max(1, $overlay->getImageWidth());
        $oh0 = max(1, $overlay->getImageHeight());
        $scale = $targetH / $oh0;
        $nw = max(1, (int) round($ow0 * $scale));
        $nh = $targetH;
        if ($nw > $targetW) {
            $scale = $targetW / $ow0;
            $nw = $targetW;
            $nh = max(1, (int) round($oh0 * $scale));
        }
        $overlay->resizeImage($nw, $nh, Imagick::FILTER_LANCZOS, 1, false);
    } else {
        // Preserve aspect inside the object box (avoid squashed «Техномер»).
        $overlay->resizeImage($targetW, $targetH, Imagick::FILTER_LANCZOS, 1, true);
    }
    $ow = $overlay->getImageWidth();
    $oh = $overlay->getImageHeight();
    $baseX = (int) ($obj['x'] ?? 0);
    $baseY = (int) ($obj['y'] ?? 0);
    $align = strtolower((string) ($obj['imageAlign'] ?? 'center'));
    if ($align === 'top-left' || $align === 'left' || $align === 'top') {
        $ox = $baseX;
        $oy = $baseY;
    } else {
        $ox = $baseX + (int) max(0, ($targetW - $ow) / 2);
        $oy = $baseY + (int) max(0, ($targetH - $oh) / 2);
    }
    $im->compositeImage($overlay, Imagick::COMPOSITE_OVER, $ox, $oy);
    $overlay->destroy();
}

/** @param array<string, mixed> $obj */
function nameplate_pdf_draw_editor_image(\TCPDF $pdf, array $obj, float $refW, float $refH, float $widthMm, float $heightMm): void
{
    $data = (string) ($obj['imageData'] ?? '');
    if ($data === '' || !str_contains($data, ',')) {
        return;
    }
    $raw = base64_decode(substr($data, strpos($data, ',') + 1), true);
    if (!is_string($raw) || $raw === '') {
        return;
    }
    $tmp = tempnam(sys_get_temp_dir(), 'npimg');
    if ($tmp === false) {
        return;
    }
    file_put_contents($tmp, $raw);
    $xMm = nameplate_pdf_px_to_mm((float) ($obj['x'] ?? 0), $refW, $widthMm);
    $yMm = nameplate_pdf_px_to_mm((float) ($obj['y'] ?? 0), $refH, $heightMm);
    $wMm = nameplate_pdf_px_to_mm((float) ($obj['w'] ?? 100), $refW, $widthMm);
    // Height 0 keeps PNG aspect ratio (no vertical squash).
    $pdf->Image($tmp, $xMm, $yMm, $wMm, 0, 'PNG');
    @unlink($tmp);
}

/** @param array<string, mixed> $obj */
function nameplate_pdf_draw_editor_line(Imagick $im, array $obj): void
{
    $x1 = (float) ($obj['x'] ?? 0);
    $y1 = (float) ($obj['y'] ?? 0);
    $x2 = isset($obj['x2']) ? (float) $obj['x2'] : ($x1 + (float) ($obj['w'] ?? 100));
    $y2 = isset($obj['y2']) ? (float) $obj['y2'] : ($y1 + (float) ($obj['h'] ?? 0));
    $stroke = max(1.0, (float) ($obj['strokeWidth'] ?? 2));
    $draw = new ImagickDraw();
    $draw->setStrokeColor(new ImagickPixel('#000000'));
    $draw->setFillColor(new ImagickPixel('none'));
    $draw->setStrokeWidth($stroke);
    $draw->line($x1, $y1, $x2, $y2);
    $im->drawImage($draw);
}

/** @param array<string, mixed> $obj */
function nameplate_pdf_draw_editor_box(Imagick $im, array $obj): void
{
    $x = (float) ($obj['x'] ?? 0);
    $y = (float) ($obj['y'] ?? 0);
    $w = max(1.0, (float) ($obj['w'] ?? 40));
    $h = max(1.0, (float) ($obj['h'] ?? 20));
    $stroke = max(1.0, (float) ($obj['strokeWidth'] ?? 2));
    $filled = !empty($obj['filled']);
    $draw = new ImagickDraw();
    $draw->setStrokeColor(new ImagickPixel('#000000'));
    $draw->setStrokeWidth($stroke);
    if ($filled) {
        $draw->setFillColor(new ImagickPixel('#000000'));
    } else {
        $draw->setFillColor(new ImagickPixel('none'));
    }
    $draw->rectangle($x, $y, $x + $w, $y + $h);
    $im->drawImage($draw);
}

/** @param array<string, string> $context */
function nameplate_pdf_render_editor_objects(Imagick $im, array $context, array $document): void
{
    require_once __DIR__ . '/nameplate_template_editor.php';
    $refH = (float) ($document['refH'] ?? 364);
    $pageHeightMm = (float) ($document['pageHeightMm'] ?? 20);
    $fontPath = nameplate_pdf_font_path();

    foreach (nameplate_editor_sorted_objects(nameplate_editor_objects($document)) as $obj) {
        if (!is_array($obj) || ($obj['visible'] ?? true) === false) {
            continue;
        }
        $type = (string) ($obj['type'] ?? '');
        if ($type === 'static') {
            continue;
        }
        if ($type === 'image') {
            nameplate_pdf_composite_editor_image($im, $obj);
            continue;
        }
        if ($type === 'qr') {
            nameplate_pdf_composite_editor_qr($im, $obj, $context);
            continue;
        }
        if ($type === 'line') {
            nameplate_pdf_draw_editor_line($im, $obj);
            continue;
        }
        if ($type === 'box' || $type === 'rect' || $type === 'rectangle') {
            nameplate_pdf_draw_editor_box($im, $obj);
            continue;
        }

        $text = nameplate_editor_object_text($obj, $context);
        if ($text === '') {
            continue;
        }

        $path = nameplate_pdf_font_path_for_object($obj, $fontPath);
        $fontPx = nameplate_pdf_font_px_for_object($obj, $refH, $pageHeightMm, $fontPath);
        $maxW = (float) ($obj['w'] ?? 0);
        $wrap = !empty($obj['wrap']);
        $lines = $wrap && $maxW > 8.0
            ? nameplate_pdf_wrap_text_to_width($text, $fontPx, $path, $maxW)
            : [$text];
        // Specs often need stroke; reserve pad so glyphs never enter the QR column.
        $strokePad = max(2.0, $fontPx * 0.08);
        $fitMinRatio = isset($obj['fitMinRatio']) ? max(0.0, min(1.0, (float) $obj['fitMinRatio'])) : 0.0;
        if (!$wrap && $maxW > 8.0) {
            $fontPx = nameplate_pdf_fit_font_px_to_width($text, $fontPx, $path, $maxW, $strokePad, $fitMinRatio);
            // Re-fit if thermal stroke will engage after shrink.
            if ($fontPx < 48.0 && $fitMinRatio <= 0.0) {
                $fontPx = nameplate_pdf_fit_font_px_to_width(
                    $text,
                    $fontPx,
                    $path,
                    $maxW,
                    max(2.0, $fontPx * 0.09),
                    $fitMinRatio
                );
            }
            $lines = [$text];
        }

        $align = Imagick::ALIGN_LEFT;
        $centerX = null;
        if (($obj['align'] ?? '') === 'center' || isset($obj['centerX'])) {
            $align = Imagick::ALIGN_CENTER;
            $centerX = (float) ($obj['centerX'] ?? ((float) ($obj['x'] ?? 0) + (float) ($obj['w'] ?? 0) / 2.0));
        }

        // Stroke helps tiny fonts on TE200, but fattens 2+ mm config lines into each other.
        $fontMmObj = isset($obj['fontMm']) ? (float) $obj['fontMm'] : 0.0;
        $thermalStroke = $fontPx < 40.0 && $fontMmObj > 0.0 && $fontMmObj < 2.0;
        $lineH = max(4.0, $fontPx * 1.05);
        $yBase = (float) ($obj['y'] ?? 0);
        foreach ($lines as $idx => $line) {
            if ($line === '') {
                continue;
            }
            nameplate_pdf_composite_text(
                $im,
                $line,
                (float) ($obj['x'] ?? 0),
                $yBase + ($idx * $lineH),
                $fontPx,
                $path,
                $align,
                $centerX,
                (float) ($obj['rotation'] ?? 0),
                $thermalStroke
            );
        }
    }
}

/** @param array<string, mixed>|null $fieldsDoc */
function nameplate_pdf_tcpdf_barcode_type(?array $fieldsDoc = null): string
{
    if (is_array($fieldsDoc)) {
        require_once __DIR__ . '/nameplate_template_editor.php';
        foreach (nameplate_editor_objects($fieldsDoc) as $obj) {
            if (!is_array($obj) || ($obj['type'] ?? '') !== 'qr') {
                continue;
            }
            $t = strtolower(trim((string) ($obj['barcodeType'] ?? 'qr')));
            if ($t === 'datamatrix' || $t === 'data_matrix') {
                return 'DATAMATRIX';
            }
        }
    }

    return 'QRCODE,H';
}

/** @param array<string, string> $context */
function nameplate_pdf_write_editor_qr_barcodes(\TCPDF $pdf, array $document, array $context, float $widthMm, float $heightMm): void
{
    require_once __DIR__ . '/nameplate_template_editor.php';
    $refW = (float) ($document['refW'] ?? 1052);
    $refH = (float) ($document['refH'] ?? 364);
    $style = [
        'border' => false,
        'vpadding' => 0,
        'hpadding' => 0,
        'fgcolor' => [0, 0, 0],
        'bgcolor' => [255, 255, 255],
    ];

    foreach (nameplate_editor_sorted_objects(nameplate_editor_objects($document)) as $obj) {
        if (!is_array($obj) || ($obj['type'] ?? '') !== 'qr' || ($obj['visible'] ?? true) === false) {
            continue;
        }
        $data = nameplate_editor_object_text($obj, $context);
        if ($data === '') {
            continue;
        }
        $barcodeType = strtolower(trim((string) ($obj['barcodeType'] ?? 'qr')));
        $xMm = nameplate_pdf_px_to_mm((float) ($obj['x'] ?? 0), $refW, $widthMm);
        $yMm = nameplate_pdf_px_to_mm((float) ($obj['y'] ?? 0), $refH, $heightMm);

        if ($barcodeType === 'code128' || $barcodeType === 'c128') {
            $wPx = (float) ($obj['w'] ?? $obj['size'] ?? 249);
            $hPx = (float) ($obj['h'] ?? max(40.0, $wPx * 0.28));
            $wMm = nameplate_pdf_px_to_mm($wPx, $refW, $widthMm);
            $hMm = nameplate_pdf_px_to_mm($hPx, $refH, $heightMm);
            $pdf->write1DBarcode($data, 'C128', $xMm, $yMm, $wMm, $hMm, 0.4, $style, 'N');
            continue;
        }

        $sizePx = (float) ($obj['size'] ?? 249);
        $qrSizeMm = nameplate_pdf_px_to_mm($sizePx, $refW, $widthMm);
        $tcpdfType = ($barcodeType === 'datamatrix' || $barcodeType === 'data_matrix')
            ? 'DATAMATRIX'
            : 'QRCODE,H';
        $pdf->write2DBarcode($data, $tcpdfType, $xMm, $yMm, $qrSizeMm, $qrSizeMm, $style, 'N');
    }
}

/**
 * Render corrector label as Imagick PNG from blank-canvas editorObjects.
 * Falls back to reference drawing ТМР.754463.091 when no override is set.
 *
 * @param array<string, string> $context
 */
function nameplate_render_corrector_raster(array $context): string
{
    if (!class_exists('Imagick')) {
        throw new RuntimeException('Imagick is not available');
    }

    require_once __DIR__ . '/nameplate_template_editor.php';
    $fieldsDoc = $GLOBALS['nameplate_fields_override'] ?? null;
    if (!is_array($fieldsDoc) || !nameplate_template_is_blank_canvas($fieldsDoc)) {
        require_once __DIR__ . '/nameplate_reference_drawing.php';
        $fieldsDoc = nameplate_editor_document_from_reference_drawing(
            (string) ($context['kind'] ?? 'corrector')
        );
        nameplate_pdf_set_fields_override($fieldsDoc);
    }

    $refW = max(100, (int) ($fieldsDoc['refW'] ?? 1052));
    $refH = max(100, (int) ($fieldsDoc['refH'] ?? 364));
    $im = new Imagick();
    $im->newImage($refW, $refH, new ImagickPixel('#ffffff'));
    $im->setImageFormat('png');
    $im->setImageType(Imagick::IMGTYPE_TRUECOLOR);

    if (is_array($fieldsDoc['editorObjects'] ?? null) && $fieldsDoc['editorObjects'] !== []) {
        nameplate_pdf_render_editor_objects($im, $context, $fieldsDoc);
    }

    $bytes = $im->getImageBlob();
    $im->clear();
    $im->destroy();

    return $bytes;
}

/** @param array<string, string> $context */
function nameplate_render_pdf_bytes_corrector_imagick(\TCPDF $pdf, array $context, float $widthMm, float $heightMm): void
{
    require_once __DIR__ . '/nameplate_template_editor.php';
    $layout = nameplate_pdf_corrector_layout();
    $refW = (float) $layout['refW'];
    $refH = (float) $layout['refH'];
    $fieldsDoc = $GLOBALS['nameplate_fields_override'] ?? null;
    $blankCanvas = is_array($fieldsDoc) && nameplate_template_is_blank_canvas($fieldsDoc);
    $pngBytes = nameplate_render_corrector_raster($context);

    $tmp = tempnam(sys_get_temp_dir(), 'np_');
    if ($tmp === false) {
        throw new RuntimeException('Не удалось создать временный файл');
    }
    $tmpPng = $tmp . '.png';
    rename($tmp, $tmpPng);
    file_put_contents($tmpPng, $pngBytes);

    try {
        $pdf->Image($tmpPng, 0, 0, $widthMm, $heightMm, 'PNG', '', '', false, 300, '', false, false, 0);

        if ($blankCanvas && is_array($fieldsDoc)) {
            nameplate_pdf_write_editor_qr_barcodes($pdf, $fieldsDoc, $context, $widthMm, $heightMm);
        } else {
    $serial = (string) ($context['serial'] ?? '');
            if ($serial !== '') {
                $qr = $layout['qr'];
                $qrSizeMm = nameplate_pdf_qr_size_mm($qr, $refW, $widthMm);
                $qrCenterXMm = nameplate_pdf_px_to_mm((float) $layout['serial']['centerX'], $refW, $widthMm);
                $qrXMm = $qrCenterXMm - ($qrSizeMm / 2.0);
                $qrYMm = nameplate_pdf_px_to_mm((float) $qr['y'], $refH, $heightMm);

                $style = [
                    'border' => false,
                    'vpadding' => 0,
                    'hpadding' => 0,
                    'fgcolor' => [0, 0, 0],
                    'bgcolor' => [255, 255, 255],
                ];
                $pdf->write2DBarcode($serial, nameplate_pdf_tcpdf_barcode_type($fieldsDoc), $qrXMm, $qrYMm, $qrSizeMm, $qrSizeMm, $style, 'N');
            }
        }
    } finally {
        @unlink($tmpPng);
    }
}

/** @param array<string, string> $context */
function nameplate_render_pdf_bytes_corrector_dynamic(\TCPDF $pdf, array $context, float $widthMm, float $heightMm): void
{
    $layout = nameplate_pdf_corrector_layout();
    $refW = (float) $layout['refW'];
    $refH = (float) $layout['refH'];

    $serial = (string) ($context['serial'] ?? '');
    $specLines = [
        (string) ($context['specLine1'] ?? ''),
        (string) ($context['specLine2'] ?? ''),
        (string) ($context['specLine3'] ?? ''),
    ];
    $release = (string) ($context['releaseLabel'] ?? '');
    $title = trim((string) ($context['productTitleShort'] ?? ''));

    $pdf->SetTextColor(0, 0, 0);
    $pdf->SetDrawColor(0, 0, 0);

    if ($title !== '' && isset($layout['title'])) {
        nameplate_pdf_draw_text_field(
            $pdf,
            $layout['title'],
            $title,
            $refW,
            $refH,
            $widthMm,
            $heightMm,
            'dejavusans',
            '',
            28.0
        );
    }

    foreach ($layout['specLines'] as $idx => $lineSpec) {
        nameplate_pdf_draw_text_field(
            $pdf,
            $lineSpec,
            $specLines[$idx] ?? '',
            $refW,
            $refH,
            $widthMm,
            $heightMm
        );
    }

    if ($release !== '') {
        nameplate_pdf_draw_text_field(
            $pdf,
            $layout['release'],
            $release,
            $refW,
            $refH,
            $widthMm,
            $heightMm,
            'dejavusans',
            '',
            24.0
        );
    }

    if ($serial !== '') {
        $qr = $layout['qr'];
        $qrSizeMm = nameplate_pdf_qr_size_mm($qr, $refW, $widthMm);
        $qrCenterXMm = nameplate_pdf_px_to_mm((float) $layout['serial']['centerX'], $refW, $widthMm);
        $qrXMm = $qrCenterXMm - ($qrSizeMm / 2.0);
        $qrYMm = nameplate_pdf_px_to_mm((float) $qr['y'], $refH, $heightMm);

        $style = [
            'border' => false,
            'vpadding' => 0,
            'hpadding' => 0,
            'fgcolor' => [0, 0, 0],
            'bgcolor' => [255, 255, 255],
        ];
        $pdf->write2DBarcode($serial, nameplate_pdf_tcpdf_barcode_type($GLOBALS['nameplate_fields_override'] ?? null), $qrXMm, $qrYMm, $qrSizeMm, $qrSizeMm, $style, 'N');

        $serialSpec = $layout['serial'];
        $serialYMm = nameplate_pdf_px_to_mm((float) $serialSpec['y'], $refH, $heightMm);
        $serialWMm = nameplate_pdf_px_to_mm((float) $serialSpec['w'], $refW, $widthMm);
        $serialHMm = nameplate_pdf_px_to_mm(33.0, $refH, $heightMm);
        $serialXMm = nameplate_pdf_px_to_mm((float) $qr['x'], $refW, $widthMm);

        $pdf->SetFont(
            'dejavusans',
            (string) ($serialSpec['style'] ?? ''),
            nameplate_pdf_font_pt_from_spec($serialSpec)
        );
        $pdf->SetXY($serialXMm, $serialYMm);
        $pdf->Cell($serialWMm, $serialHMm, $serial, 0, 0, 'C', false, '', 0, false, true, 'T');
    }
}

/** @param array<string, string> $context */
function nameplate_render_pdf_bytes_corrector_legacy(\TCPDF $pdf, array $context, float $widthMm, float $heightMm): void
{
    $layout = nameplate_pdf_corrector_layout();
    $refW = (float) $layout['refW'];
    $refH = (float) $layout['refH'];

    $staticPath = nameplate_pdf_static_image_path((string) ($context['kind'] ?? 'corrector'));
    if ($staticPath !== null) {
        $pdf->Image($staticPath, 0, 0, $widthMm, $heightMm, '', '', '', false, 300, '', false, false, 0);
    }

    $serial = (string) ($context['serial'] ?? '');
    $spec1 = (string) ($context['specLine1'] ?? '');
    $spec2 = (string) ($context['specLine2'] ?? '');
    $spec3 = (string) ($context['specLine3'] ?? '');
    $release = (string) ($context['releaseLabel'] ?? '');
    $brand = trim((string) ($context['brandLabel'] ?? ''));
    $title = trim((string) ($context['productTitleShort'] ?? ''));

    $pdf->SetTextColor(0, 0, 0);
    $pdf->SetDrawColor(0, 0, 0);

    if ($brand !== '' && isset($layout['brand'])) {
        nameplate_pdf_draw_text_field(
            $pdf,
            $layout['brand'],
            $brand,
            $refW,
            $refH,
            $widthMm,
            $heightMm,
            'dejavusans',
            (string) ($layout['brand']['style'] ?? 'B'),
            22.0
        );
    }

    if ($title !== '' && isset($layout['title'])) {
        nameplate_pdf_draw_text_field(
            $pdf,
            $layout['title'],
            $title,
            $refW,
            $refH,
            $widthMm,
            $heightMm,
            'dejavusans',
            (string) ($layout['title']['style'] ?? ''),
            28.0
        );
    }

    $specLines = [$spec1, $spec2, $spec3];
    foreach ($layout['specLines'] as $idx => $lineSpec) {
        nameplate_pdf_draw_text_field(
            $pdf,
            $lineSpec,
            $specLines[$idx] ?? '',
            $refW,
            $refH,
            $widthMm,
            $heightMm
        );
    }

    if ($release !== '') {
        nameplate_pdf_draw_text_field(
            $pdf,
            $layout['release'],
            $release,
            $refW,
            $refH,
            $widthMm,
            $heightMm,
            'dejavusans',
            '',
            24.0
        );
    }

    if ($serial !== '') {
        $qr = $layout['qr'];
        $qrSizeMm = nameplate_pdf_qr_size_mm($qr, $refW, $widthMm);
        $qrCenterXMm = nameplate_pdf_px_to_mm(
            (float) $layout['serial']['centerX'],
            $refW,
            $widthMm
        );
        $qrXMm = $qrCenterXMm - ($qrSizeMm / 2.0);
        $qrYMm = nameplate_pdf_px_to_mm((float) $qr['y'], $refH, $heightMm);

        $style = [
            'border' => false,
            'vpadding' => 0,
            'hpadding' => 0,
            'fgcolor' => [0, 0, 0],
            'bgcolor' => [255, 255, 255],
        ];
        $pdf->write2DBarcode($serial, nameplate_pdf_tcpdf_barcode_type($GLOBALS['nameplate_fields_override'] ?? null), $qrXMm, $qrYMm, $qrSizeMm, $qrSizeMm, $style, 'N');

        $serialSpec = $layout['serial'];
        $serialYMm = nameplate_pdf_px_to_mm((float) $serialSpec['y'], $refH, $heightMm);
        $serialWMm = nameplate_pdf_px_to_mm((float) $serialSpec['w'], $refW, $widthMm);
        $serialHMm = nameplate_pdf_px_to_mm(33.0, $refH, $heightMm);
        $serialXMm = nameplate_pdf_px_to_mm((float) $qr['x'], $refW, $widthMm);

        $pdf->SetFont(
            'dejavusans',
            (string) ($serialSpec['style'] ?? ''),
            nameplate_pdf_font_pt_from_spec($serialSpec)
        );
        $pdf->SetXY($serialXMm, $serialYMm);
        $pdf->Cell($serialWMm, $serialHMm, $serial, 0, 0, 'C', false, '', 0, false, true, 'T');
    }
}

/** @param array<string, string> $context */
function nameplate_render_pdf_bytes_corrector(\TCPDF $pdf, array $context, float $widthMm, float $heightMm, ?array $config = null): void
{
    require_once __DIR__ . '/nameplate_template_editor.php';
    $fieldsDoc = $GLOBALS['nameplate_fields_override'] ?? null;
    if (is_array($fieldsDoc) && nameplate_template_is_blank_canvas($fieldsDoc)) {
        if (class_exists('Imagick')) {
            nameplate_render_pdf_bytes_corrector_imagick($pdf, $context, $widthMm, $heightMm);

            return;
        }
        require_once __DIR__ . '/nameplate_template_editor.php';
        $refW = (float) ($fieldsDoc['refW'] ?? 1052);
        $refH = (float) ($fieldsDoc['refH'] ?? 364);
        $pdf->SetFillColor(255, 255, 255);
        $pdf->Rect(0, 0, $widthMm, $heightMm, 'F');
        $pdf->SetTextColor(0, 0, 0);
        foreach (nameplate_editor_sorted_objects(nameplate_editor_objects($fieldsDoc)) as $obj) {
            if (!is_array($obj) || ($obj['visible'] ?? true) === false || ($obj['type'] ?? '') === 'qr' || ($obj['type'] ?? '') === 'static') {
                continue;
            }
            $type = (string) ($obj['type'] ?? '');
            if ($type === 'line') {
                $x1 = nameplate_pdf_px_to_mm((float) ($obj['x'] ?? 0), $refW, $widthMm);
                $y1 = nameplate_pdf_px_to_mm((float) ($obj['y'] ?? 0), $refH, $heightMm);
                $x2 = nameplate_pdf_px_to_mm((float) ($obj['x2'] ?? (($obj['x'] ?? 0) + ($obj['w'] ?? 100))), $refW, $widthMm);
                $y2 = nameplate_pdf_px_to_mm((float) ($obj['y2'] ?? ($obj['y'] ?? 0)), $refH, $heightMm);
                $pdf->SetDrawColor(0, 0, 0);
                $pdf->SetLineWidth(max(0.1, nameplate_pdf_px_to_mm((float) ($obj['strokeWidth'] ?? 2), $refW, $widthMm)));
                $pdf->Line($x1, $y1, $x2, $y2);
                continue;
            }
            if ($type === 'box' || $type === 'rect' || $type === 'rectangle') {
                $x = nameplate_pdf_px_to_mm((float) ($obj['x'] ?? 0), $refW, $widthMm);
                $y = nameplate_pdf_px_to_mm((float) ($obj['y'] ?? 0), $refH, $heightMm);
                $w = nameplate_pdf_px_to_mm(max(1.0, (float) ($obj['w'] ?? 40)), $refW, $widthMm);
                $h = nameplate_pdf_px_to_mm(max(1.0, (float) ($obj['h'] ?? 20)), $refH, $heightMm);
                $pdf->SetDrawColor(0, 0, 0);
                $pdf->SetLineWidth(max(0.1, nameplate_pdf_px_to_mm((float) ($obj['strokeWidth'] ?? 2), $refW, $widthMm)));
                if (!empty($obj['filled'])) {
                    $pdf->SetFillColor(0, 0, 0);
                    $pdf->Rect($x, $y, $w, $h, 'DF');
                } else {
                    $pdf->Rect($x, $y, $w, $h, 'D');
                }
                continue;
            }
            if ($type === 'image') {
                nameplate_pdf_draw_editor_image($pdf, $obj, $refW, $refH, $widthMm, $heightMm);
                continue;
            }
            $text = nameplate_editor_object_text($obj, $context);
    if ($text === '') {
                continue;
            }
            $spec = [
                'x' => (float) ($obj['x'] ?? 0),
                'y' => (float) ($obj['y'] ?? 0),
                'font' => (float) ($obj['fontPt'] ?? 4.2),
                'style' => !empty($obj['bold']) ? 'B' : '',
                'align' => ($obj['align'] ?? '') === 'center' || isset($obj['centerX']) ? 'C' : 'L',
                'centerX' => isset($obj['centerX']) ? (float) $obj['centerX'] : null,
                'w' => (float) ($obj['w'] ?? 680),
                'rotation' => (float) ($obj['rotation'] ?? 0),
            ];
            $font = !empty($obj['mono']) ? 'dejavusansmono' : 'dejavusans';
            nameplate_pdf_draw_text_field($pdf, $spec, $text, $refW, $refH, $widthMm, $heightMm, $font, $spec['style'], 28.0);
        }
        nameplate_pdf_write_editor_qr_barcodes($pdf, $fieldsDoc, $context, $widthMm, $heightMm);

        return;
    }

    $kind = (string) ($context['kind'] ?? 'corrector');
    require_once __DIR__ . '/nameplate_template_editor.php';
    $overrideDoc = $GLOBALS['nameplate_fields_override'] ?? null;
    $hasBlankOverride = is_array($overrideDoc) && nameplate_template_is_blank_canvas($overrideDoc);
    if (
        in_array(strtolower(trim($kind)), ['corrector', '300', 'complex', '400'], true)
        && class_exists('Imagick')
        && ($hasBlankOverride
            || nameplate_pdf_btw_preview_png_path() !== null
            || nameplate_pdf_static_image_path($kind) !== null)
    ) {
        nameplate_render_pdf_bytes_corrector_imagick($pdf, $context, $widthMm, $heightMm);

        return;
    }

    $templatePath = nameplate_pdf_template_path($kind, $config);
    if ($templatePath !== null) {
        nameplate_render_pdf_bytes_corrector_dynamic($pdf, $context, $widthMm, $heightMm);

        return;
    }

    nameplate_render_pdf_bytes_corrector_legacy($pdf, $context, $widthMm, $heightMm);
}

/** @param array<string, string> $context */
function nameplate_render_pdf_bytes(array $context, ?array $config = null, ?array $fieldsOverride = null): string
{
    nameplate_pdf_autoload();
    if ($fieldsOverride !== null) {
        nameplate_pdf_set_fields_override($fieldsOverride);
    }
    try {
        return nameplate_render_pdf_bytes_inner($context, $config);
    } finally {
        if ($fieldsOverride !== null) {
            nameplate_pdf_clear_fields_override();
        }
    }
}

/** @param array<string, string> $context */
function nameplate_render_pdf_bytes_inner(array $context, ?array $config = null): string
{
    nameplate_pdf_autoload();
    [$widthMm, $heightMm] = nameplate_pdf_page_size($config);
    $kind = strtolower(trim((string) ($context['kind'] ?? 'corrector')));
    $supportsBlankRaster = in_array($kind, ['corrector', '300', 'complex', '400'], true);
    $useImagickRaster = $supportsBlankRaster
        && class_exists('Imagick')
        && (nameplate_pdf_btw_preview_png_path() !== null || nameplate_pdf_static_image_path($kind) !== null);
    $templatePath = (!$useImagickRaster && in_array($kind, ['corrector', '300'], true))
        ? nameplate_pdf_template_path($kind, $config)
        : null;

    $pdf = nameplate_pdf_init_document($widthMm, $heightMm, $templatePath);
    $pdf->SetCreator('TM-07 bench');
    $pdf->SetAuthor('TM-07');
    $pdf->SetTitle('Шильдик ' . ($context['serial'] ?? ''));

    if ($kind === 'corrector' || $kind === '300' || $kind === 'complex' || $kind === '400') {
        nameplate_render_pdf_bytes_corrector($pdf, $context, $widthMm, $heightMm, $config);
    } else {
        throw new RuntimeException('PDF-шаблон для kind=' . $kind . ' не настроен');
    }

    return $pdf->Output('', 'S');
}

/** @param array<string, scalar|null> $data */
function nameplate_render_pdf(array $data, ?array $config = null): string
{
    $context = nameplate_build_context($data);

    return nameplate_render_pdf_bytes($context, $config);
}

/** @param array<string, scalar|null> $data */
function nameplate_generate_pdf_file(array $data, ?array $config = null, ?array $fieldsOverride = null): array
{
    $context = nameplate_build_context($data);
    $bytes = nameplate_render_pdf_bytes($context, $config, $fieldsOverride);
    $filename = nameplate_pdf_filename($context['serial'], $context['kind']);
    $path = nameplate_generated_dir() . '/' . $filename;

    if (file_put_contents($path, $bytes) === false) {
        throw new RuntimeException('Не удалось сохранить PDF');
    }

    return [
        'filename' => $filename,
        'path' => $path,
        'size' => strlen($bytes),
        'filled' => true,
        'mime' => 'application/pdf',
        'downloadUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($filename),
        'previewUrl' => '/api/nameplate-print.php?action=preview&file=' . rawurlencode($filename),
    ];
}
