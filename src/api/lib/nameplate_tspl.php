<?php
declare(strict_types=1);

require_once __DIR__ . '/nameplate_pdf.php';

function nameplate_tspl_dpi(?array $config = null): int
{
    $cfg = $config ?? nameplate_load_config();
    $pa = is_array($cfg['printAgent'] ?? null) ? $cfg['printAgent'] : [];
    $dpi = (int) ($pa['dpi'] ?? 203);

    return $dpi > 0 ? $dpi : 203;
}

function nameplate_tspl_gap_mm(?array $config = null): float
{
    $cfg = $config ?? nameplate_load_config();
    $pa = is_array($cfg['printAgent'] ?? null) ? $cfg['printAgent'] : [];

    return max(0.0, (float) ($pa['gapMm'] ?? 2.0));
}

function nameplate_tspl_y_offset_dots(?array $config = null): int
{
    $cfg = $config ?? nameplate_load_config();
    $pa = is_array($cfg['printAgent'] ?? null) ? $cfg['printAgent'] : [];
    $mm = (float) ($pa['yOffsetMm'] ?? 0.0);
    $dpi = nameplate_tspl_dpi($config);

    // Positive → white pad on top of bitmap (content lower on the sticker).
    return (int) round($mm * $dpi / 25.4);
}

function nameplate_tspl_direction(?array $config = null): int
{
    $cfg = $config ?? nameplate_load_config();
    $pa = is_array($cfg['printAgent'] ?? null) ? $cfg['printAgent'] : [];
    $dir = (int) ($pa['direction'] ?? 1);

    return ($dir === 0) ? 0 : 1;
}

/** Print darkness 0–15 (TSC DENSITY). Higher = darker. */
function nameplate_tspl_density(?array $config = null): int
{
    $cfg = $config ?? nameplate_load_config();
    $pa = is_array($cfg['printAgent'] ?? null) ? $cfg['printAgent'] : [];
    $d = (int) ($pa['density'] ?? 15);

    return max(0, min(15, $d));
}

/** Print speed in ips (TSC SPEED). Lower = sharper/darker. Typical 2–4. */
function nameplate_tspl_speed(?array $config = null): float
{
    $cfg = $config ?? nameplate_load_config();
    $pa = is_array($cfg['printAgent'] ?? null) ? $cfg['printAgent'] : [];
    $s = (float) ($pa['speed'] ?? 2.0);
    if ($s < 1.0) {
        $s = 1.0;
    }
    if ($s > 12.0) {
        $s = 12.0;
    }

    return $s;
}

/**
 * Binarization threshold 0..1 (fraction of quantum).
 * Higher → more gray antialias becomes solid black (thicker strokes).
 */
function nameplate_tspl_threshold(?array $config = null): float
{
    $cfg = $config ?? nameplate_load_config();
    $pa = is_array($cfg['printAgent'] ?? null) ? $cfg['printAgent'] : [];
    $t = (float) ($pa['threshold'] ?? 0.72);
    if ($t < 0.35) {
        $t = 0.35;
    }
    if ($t > 0.92) {
        $t = 0.92;
    }

    return $t;
}

/**
 * Place label artwork on a full-size white canvas.
 *
 * Always stretch to full label width (no letterbox). Positive $yOffsetDots =
 * white pad on top → content lower on the sticker.
 */
function nameplate_tspl_prepare_label_bitmap(
    Imagick $im,
    int $targetW,
    int $targetH,
    int $yOffsetDots,
    int $direction = 1
): Imagick {
    unset($direction);

    $im->setImageBackgroundColor('white');
    $im->setImageAlphaChannel(Imagick::ALPHACHANNEL_REMOVE);
    if (defined('Imagick::LAYERMETHOD_FLATTEN')) {
        $im = $im->mergeImageLayers(Imagick::LAYERMETHOD_FLATTEN);
    }

    $pad = abs($yOffsetDots);
    $usableH = max(1, $targetH - $pad);
    // Exact fill — letterboxing left the artwork tiny in the corner on TE200.
    $im->resizeImage($targetW, $usableH, Imagick::FILTER_LANCZOS, 1, false);
    $composeX = 0;
    $composeY = ($yOffsetDots > 0) ? $pad : 0;

    if ($composeX === 0 && $composeY === 0 && $im->getImageWidth() === $targetW && $im->getImageHeight() === $targetH) {
        return $im;
    }

    $canvas = new Imagick();
    $canvas->newImage($targetW, $targetH, new ImagickPixel('#ffffff'));
    $canvas->setImageFormat('png');
    $canvas->compositeImage($im, Imagick::COMPOSITE_OVER, $composeX, $composeY);
    $im->clear();
    $im->destroy();

    return $canvas;
}

function nameplate_tspl_home_before_print(?array $config = null): bool
{
    $cfg = $config ?? nameplate_load_config();
    $pa = is_array($cfg['printAgent'] ?? null) ? $cfg['printAgent'] : [];

    return ($pa['homeBeforePrint'] ?? false) === true;
}

function nameplate_tspl_filename(string $serial, string $kind): string
{
    $serial = trim($serial);
    $kind = strtolower(trim($kind));
    if (!preg_match('/^\d{10}$/', $serial)) {
        throw new InvalidArgumentException('serial: 10 цифр');
    }
    if ($kind !== 'corrector' && $kind !== 'complex') {
        throw new InvalidArgumentException('kind: corrector или complex');
    }

    return $serial . '-' . $kind . '.tspl';
}

/** Convert rendered PDF page to flattened PNG bytes at print DPI. */
function nameplate_pdf_bytes_to_png(string $pdfBytes, ?array $config = null): string
{
    if (!class_exists('Imagick')) {
        throw new RuntimeException('Imagick is required for TSPL generation');
    }

    $dpi = nameplate_tspl_dpi($config);
    $im = new Imagick();
    $im->setResolution($dpi, $dpi);
    $im->readImageBlob($pdfBytes);
    $im->setIteratorIndex(0);
    $im->setImageBackgroundColor('white');
    $im->setImageAlphaChannel(Imagick::ALPHACHANNEL_REMOVE);
    if (defined('Imagick::LAYERMETHOD_FLATTEN')) {
        $im = $im->mergeImageLayers(Imagick::LAYERMETHOD_FLATTEN);
    }
    $im->setImageFormat('png');
    $im->setImageColorspace(Imagick::COLORSPACE_GRAY);

    $bytes = $im->getImageBlob();
    $im->clear();
    $im->destroy();

    return $bytes;
}

/**
 * Rasterize PDF then apply the same bilevel threshold used for TSPL BITMAP.
 */
function nameplate_pdf_bytes_to_thermal_png(string $pdfBytes, float $widthMm, float $heightMm, ?array $config = null): string
{
    if (!class_exists('Imagick')) {
        throw new RuntimeException('Imagick is required for thermal preview');
    }

    $png = nameplate_pdf_bytes_to_png($pdfBytes, $config);
    $dpi = nameplate_tspl_dpi($config);
    $targetW = max(1, (int) round($widthMm * $dpi / 25.4));
    $targetH = max(1, (int) round($heightMm * $dpi / 25.4));
    $yOffsetDots = nameplate_tspl_y_offset_dots($config);
    $direction = nameplate_tspl_direction($config);

    $im = new Imagick();
    $im->readImageBlob($png);
    $im = nameplate_tspl_prepare_label_bitmap($im, $targetW, $targetH, $yOffsetDots, $direction);
    $im->transformImageColorspace(Imagick::COLORSPACE_GRAY);
    $im->setImageBackgroundColor('white');
    if (defined('Imagick::LAYERMETHOD_FLATTEN')) {
        $flat = $im->mergeImageLayers(Imagick::LAYERMETHOD_FLATTEN);
        $im->clear();
        $im->destroy();
        $im = $flat;
    }
    try {
        $im->sigmoidalContrastImage(true, 8.0, 0.45 * (float) Imagick::getQuantum());
    } catch (Throwable) {
    }
    $threshold = nameplate_tspl_threshold($config);
    $im->thresholdImage($threshold * (float) Imagick::getQuantum());
    $im->setImageType(Imagick::IMGTYPE_BILEVEL);
    $im->setImageFormat('png');
    $bytes = $im->getImageBlob();
    $im->clear();
    $im->destroy();

    return $bytes;
}

/** @return array{0: float, 1: float} */
function nameplate_tspl_page_size_mm(?array $config = null, ?array $fieldsOverride = null): array
{
    if (is_array($fieldsOverride)) {
        $widthMm = (float) ($fieldsOverride['pageWidthMm'] ?? 0);
        $heightMm = (float) ($fieldsOverride['pageHeightMm'] ?? 0);
        if ($widthMm > 0 && $heightMm > 0) {
            return [$widthMm, $heightMm];
        }
    }

    return nameplate_pdf_page_size($config);
}

/**
 * Build TSPL job with embedded BITMAP for TSC TE200 (203 dpi default).
 *
 * @return array{bytes: string, widthDots: int, heightDots: int, widthBytes: int}
 */
function nameplate_png_to_tspl(string $pngBytes, float $widthMm, float $heightMm, ?array $config = null): array
{
    if (!class_exists('Imagick')) {
        throw new RuntimeException('Imagick is required for TSPL generation');
    }

    $dpi = nameplate_tspl_dpi($config);
    $targetW = max(1, (int) round($widthMm * $dpi / 25.4));
    $targetH = max(1, (int) round($heightMm * $dpi / 25.4));
    $gapMm = nameplate_tspl_gap_mm($config);
    $yOffsetDots = nameplate_tspl_y_offset_dots($config);
    $direction = nameplate_tspl_direction($config);

    $im = new Imagick();
    $im->readImageBlob($pngBytes);
    $im = nameplate_tspl_prepare_label_bitmap($im, $targetW, $targetH, $yOffsetDots, $direction);

    // Solid 1-bit for thermal: boost contrast, then hard threshold (thickens thin glyphs).
    $im->transformImageColorspace(Imagick::COLORSPACE_GRAY);
    $im->setImageBackgroundColor('white');
    if (defined('Imagick::LAYERMETHOD_FLATTEN')) {
        $flat = $im->mergeImageLayers(Imagick::LAYERMETHOD_FLATTEN);
        $im->clear();
        $im->destroy();
        $im = $flat;
    }
    try {
        $im->sigmoidalContrastImage(true, 8.0, 0.45 * (float) Imagick::getQuantum());
    } catch (Throwable) {
        // optional; continue without contrast boost
    }
    $threshold = nameplate_tspl_threshold($config);
    $im->thresholdImage($threshold * (float) Imagick::getQuantum());
    $im->setImageType(Imagick::IMGTYPE_BILEVEL);

    $width = $im->getImageWidth();
    $height = $im->getImageHeight();
    $widthBytes = (int) ceil($width / 8);
    $pixels = $im->exportImagePixels(0, 0, $width, $height, 'I', Imagick::PIXEL_CHAR);
    $im->clear();
    $im->destroy();

    if (!is_array($pixels)) {
        throw new RuntimeException('Не удалось получить пиксели для TSPL');
    }

    // TSC BITMAP on TE200: keep proven polarity (light→1) — auto-invert caused white-on-black.
    $bitmap = '';
    for ($y = 0; $y < $height; $y += 1) {
        for ($xByte = 0; $xByte < $widthBytes; $xByte += 1) {
            $byte = 0;
            for ($bit = 0; $bit < 8; $bit += 1) {
                $x = ($xByte * 8) + $bit;
                $dot = 0;
                if ($x < $width) {
                    $idx = ($y * $width) + $x;
                    $gray = (int) ($pixels[$idx] ?? 255);
                    $dot = $gray >= 128 ? 1 : 0;
                }
                $byte |= ($dot << (7 - $bit));
            }
            $bitmap .= chr($byte);
        }
    }

    $widthMmText = rtrim(rtrim(number_format($widthMm, 2, '.', ''), '0'), '.');
    $heightMmText = rtrim(rtrim(number_format($heightMm, 2, '.', ''), '0'), '.');
    $gapText = rtrim(rtrim(number_format($gapMm, 2, '.', ''), '0'), '.');
    $density = nameplate_tspl_density($config);
    $speed = nameplate_tspl_speed($config);
    $speedText = rtrim(rtrim(number_format($speed, 1, '.', ''), '0'), '.');

    $headerLines = [
        'SIZE ' . $widthMmText . ' mm, ' . $heightMmText . ' mm',
        'GAP ' . $gapText . ' mm, 0 mm',
        'DIRECTION ' . nameplate_tspl_direction($config),
        'REFERENCE 0,0',
        'OFFSET 0 mm',
        'SPEED ' . $speedText,
        'DENSITY ' . $density,
        'SET PEEL OFF',
        'SET CUTTER OFF',
        'SET PARTIAL_CUTTER OFF',
        'SET TEAR ON',
    ];
    if (nameplate_tspl_home_before_print($config)) {
        $headerLines[] = 'HOME';
    }
    $headerLines[] = 'CLS';
    $header = implode("\r\n", $headerLines) . "\r\n";

    // Bitmap always starts at Y=0; vertical calibration is baked into the canvas.
    $bitmapHeader = 'BITMAP 0,0,' . $widthBytes . ',' . $height . ',0,';
    $footer = "\r\nPRINT 1,1\r\n";
    $bytes = $header . $bitmapHeader . $bitmap . $footer;

    return [
        'bytes' => $bytes,
        'widthDots' => $width,
        'heightDots' => $height,
        'widthBytes' => $widthBytes,
    ];
}

/** @param array<string, scalar|null> $data */
function nameplate_render_tspl_bytes(array $data, ?array $config = null, ?array $fieldsOverride = null): string
{
    [$widthMm, $heightMm] = nameplate_tspl_page_size_mm($config, $fieldsOverride);
    $context = nameplate_build_context($data);
    $pngBytes = nameplate_render_print_png_bytes($context, $config, $fieldsOverride);

    return nameplate_png_to_tspl($pngBytes, $widthMm, $heightMm, $config)['bytes'];
}

/**
 * Print PNG at printAgent dpi (58×20 mm @ 203 dpi → ~464×160). No crop-to-ink.
 * Does not apply yOffsetMm (that is applied once in TSPL / preview helpers).
 *
 * @param array<string, string> $context
 */
function nameplate_render_print_png_bytes(array $context, ?array $config = null, ?array $fieldsOverride = null): string
{
    if ($fieldsOverride !== null) {
        nameplate_pdf_set_fields_override($fieldsOverride);
    }
    try {
        $pngBytes = nameplate_render_corrector_raster($context);
        $override = $fieldsOverride ?? ($GLOBALS['nameplate_fields_override'] ?? null);
        [$widthMm, $heightMm] = nameplate_tspl_page_size_mm($config, is_array($override) ? $override : null);
        $dpi = nameplate_tspl_dpi($config);
        $targetW = max(1, (int) round($widthMm * $dpi / 25.4));
        $targetH = max(1, (int) round($heightMm * $dpi / 25.4));

        $im = new Imagick();
        $im->readImageBlob($pngBytes);
        $im->setImageBackgroundColor('white');
        if (defined('Imagick::LAYERMETHOD_FLATTEN')) {
            $flat = $im->mergeImageLayers(Imagick::LAYERMETHOD_FLATTEN);
            $im->clear();
            $im->destroy();
            $im = $flat;
        }
        $im->resizeImage($targetW, $targetH, Imagick::FILTER_LANCZOS, 1, false);
        $im->setImageFormat('png');
        $im->setImageColorspace(Imagick::COLORSPACE_GRAY);
        $out = $im->getImageBlob();
        $im->clear();
        $im->destroy();

        return $out;
    } finally {
        if ($fieldsOverride !== null) {
            nameplate_pdf_clear_fields_override();
        }
    }
}

/** Apply printAgent.yOffsetMm (pad top → content lower). */
function nameplate_png_apply_y_offset(string $pngBytes, float $widthMm, float $heightMm, ?array $config = null): string
{
    $yOffsetDots = nameplate_tspl_y_offset_dots($config);
    if ($yOffsetDots === 0) {
        return $pngBytes;
    }
    $dpi = nameplate_tspl_dpi($config);
    $targetW = max(1, (int) round($widthMm * $dpi / 25.4));
    $targetH = max(1, (int) round($heightMm * $dpi / 25.4));
    $im = new Imagick();
    $im->readImageBlob($pngBytes);
    $im = nameplate_tspl_prepare_label_bitmap(
        $im,
        $targetW,
        $targetH,
        $yOffsetDots,
        nameplate_tspl_direction($config)
    );
    $im->setImageFormat('png');
    $out = $im->getImageBlob();
    $im->clear();
    $im->destroy();

    return $out;
}

function nameplate_png_filename(string $serial, string $kind): string
{
    $serial = trim($serial);
    $kind = strtolower(trim($kind));
    if (!preg_match('/^\d{10}$/', $serial)) {
        throw new InvalidArgumentException('serial: 10 цифр');
    }
    if ($kind !== 'corrector' && $kind !== 'complex') {
        throw new InvalidArgumentException('kind: corrector или complex');
    }

    return $serial . '-' . $kind . '.png';
}

/** @param array<string, scalar|null> $data */
function nameplate_generate_png_file(array $data, ?array $config = null, ?array $fieldsOverride = null): array
{
    if ($fieldsOverride !== null) {
        nameplate_pdf_set_fields_override($fieldsOverride);
    }
    try {
        $context = nameplate_build_context($data);
        [$widthMm, $heightMm] = nameplate_tspl_page_size_mm($config, $fieldsOverride);
        $pngBytes = nameplate_render_print_png_bytes($context, $config, $fieldsOverride);
        $pngBytes = nameplate_png_apply_y_offset($pngBytes, $widthMm, $heightMm, $config);
    } finally {
        if ($fieldsOverride !== null) {
            nameplate_pdf_clear_fields_override();
        }
    }
    $filename = nameplate_png_filename($context['serial'], $context['kind']);
    $path = nameplate_generated_dir() . '/' . $filename;

    if (file_put_contents($path, $pngBytes) === false) {
        throw new RuntimeException('Не удалось сохранить PNG');
    }

    return [
        'filename' => $filename,
        'path' => $path,
        'size' => strlen($pngBytes),
        'filled' => true,
        'mime' => 'image/png',
        'downloadUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($filename),
        'previewUrl' => '/api/nameplate-print.php?action=preview&file=' . rawurlencode($filename),
        'pngDownloadUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($filename),
        'dpi' => nameplate_tspl_dpi($config),
    ];
}

/** @param array<string, scalar|null> $data */
function nameplate_generate_tspl_file(array $data, ?array $config = null, ?array $fieldsOverride = null): array
{
    if ($fieldsOverride !== null) {
        nameplate_pdf_set_fields_override($fieldsOverride);
    }
    try {
        $context = nameplate_build_context($data);
        [$widthMm, $heightMm] = nameplate_tspl_page_size_mm($config, $fieldsOverride);
        $pngBytes = nameplate_render_print_png_bytes($context, $config, $fieldsOverride);
    } finally {
        if ($fieldsOverride !== null) {
            nameplate_pdf_clear_fields_override();
        }
    }
    $tspl = nameplate_png_to_tspl($pngBytes, $widthMm, $heightMm, $config);
    $previewPng = nameplate_png_apply_y_offset($pngBytes, $widthMm, $heightMm, $config);

    $pngName = nameplate_png_filename($context['serial'], $context['kind']);
    $pngPath = nameplate_generated_dir() . '/' . $pngName;
    file_put_contents($pngPath, $previewPng);

    $filename = nameplate_tspl_filename($context['serial'], $context['kind']);
    $path = nameplate_generated_dir() . '/' . $filename;

    if (file_put_contents($path, $tspl['bytes']) === false) {
        throw new RuntimeException('Не удалось сохранить TSPL');
    }

    return [
        'filename' => $filename,
        'path' => $path,
        'size' => strlen($tspl['bytes']),
        'filled' => true,
        'mime' => 'application/octet-stream',
        'downloadUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($filename),
        'pngFilename' => $pngName,
        'pngPath' => $pngPath,
        'pngDownloadUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($pngName),
        'previewUrl' => '/api/nameplate-print.php?action=preview&file=' . rawurlencode($pngName),
        'widthDots' => $tspl['widthDots'],
        'heightDots' => $tspl['heightDots'],
        'widthBytes' => $tspl['widthBytes'],
        'dpi' => nameplate_tspl_dpi($config),
    ];
}

/**
 * Send TSPL bytes straight from the site (PHP) to the printer — no Windows agent.
 *
 * Modes (printAgent.direct):
 *  - dev  — raw write to a USB device on this host, e.g. /dev/usb/lp0 (Linux).
 *  - tcp  — raw socket host:port (TSC Ethernet, default 9100).
 *  - cups — CUPS raw queue on this host: `lp -d QUEUE -o raw -`.
 *
 * @param array<string, mixed> $config
 * @return array{ok: bool, mode: string, error?: string, bytes?: int}
 */
function nameplate_tspl_send_direct(string $bytes, array $config): array
{
    if ($bytes === '') {
        return ['ok' => false, 'mode' => '?', 'error' => 'Пустые данные печати'];
    }

    $pa = is_array($config['printAgent'] ?? null) ? $config['printAgent'] : [];
    $direct = is_array($pa['direct'] ?? null) ? $pa['direct'] : [];
    $mode = strtolower(trim((string) ($direct['mode'] ?? 'dev')));

    if (empty($direct['enabled'])) {
        return ['ok' => false, 'mode' => $mode, 'error' => 'Прямая печать отключена (printAgent.direct.enabled=false)'];
    }

    if ($mode === 'dev') {
        $device = trim((string) ($direct['device'] ?? '/dev/usb/lp0'));
        if ($device === '') {
            return ['ok' => false, 'mode' => $mode, 'error' => 'Не задан printAgent.direct.device'];
        }
        $fp = @fopen($device, 'wb');
        if ($fp === false) {
            return ['ok' => false, 'mode' => $mode, 'error' => 'Не удалось открыть устройство ' . $device . ' (есть ли USB-принтер и доступ?)'];
        }
        $written = fwrite($fp, $bytes);
        if ($written !== false && $written > 0) {
            fflush($fp);
        }
        fclose($fp);
        if ($written === false || $written === 0) {
            return ['ok' => false, 'mode' => $mode, 'error' => 'Не удалось записать данные в ' . $device];
        }

        return ['ok' => true, 'mode' => $mode, 'bytes' => $written];
    }

    if ($mode === 'tcp') {
        $host = trim((string) ($direct['host'] ?? ''));
        $port = (int) ($direct['port'] ?? 9100);
        if ($host === '') {
            return ['ok' => false, 'mode' => $mode, 'error' => 'Не задан printAgent.direct.host'];
        }
        $errno = 0;
        $errstr = '';
        $fp = @stream_socket_client('tcp://' . $host . ':' . $port, $errno, $errstr, 5.0);
        if ($fp === false) {
            return ['ok' => false, 'mode' => $mode, 'error' => 'Не удалось подключиться к ' . $host . ':' . $port . ' — ' . $errstr];
        }
        stream_set_timeout($fp, 5);
        $written = fwrite($fp, $bytes);
        fclose($fp);
        if ($written === false || $written === 0) {
            return ['ok' => false, 'mode' => $mode, 'error' => 'Не удалось отправить данные на ' . $host . ':' . $port];
        }

        return ['ok' => true, 'mode' => $mode, 'bytes' => $written];
    }

    if ($mode === 'cups') {
        $queue = trim((string) ($direct['cupsQueue'] ?? ''));
        if ($queue === '') {
            return ['ok' => false, 'mode' => $mode, 'error' => 'Не задан printAgent.direct.cupsQueue'];
        }

        $cmd = ['lp', '-d', $queue, '-o', 'raw', '-'];
        $proc = @proc_open($cmd, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        if (!is_resource($proc)) {
            return ['ok' => false, 'mode' => $mode, 'error' => 'Не удалось запустить lp (CUPS)'];
        }

        fwrite($pipes[0], $bytes);
        fclose($pipes[0]);
        $err = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $code = proc_close($proc) ?? 0;
        if ($code !== 0) {
            return ['ok' => false, 'mode' => $mode, 'error' => 'lp завершился с кодом ' . $code . ': ' . trim($err)];
        }

        return ['ok' => true, 'mode' => $mode, 'bytes' => strlen($bytes)];
    }

    return ['ok' => false, 'mode' => $mode, 'error' => 'Неизвестный режим printAgent.direct.mode: ' . $mode];
}
