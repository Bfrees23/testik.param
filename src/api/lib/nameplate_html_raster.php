<?php
declare(strict_types=1);

// Loaded from nameplate_print.php after core helpers exist.
require_once __DIR__ . '/nameplate_tspl.php';

/**
 * Resolve Chromium binary for headless HTML rasterization.
 */
function nameplate_chromium_binary(?array $config = null): string
{
    $cfg = $config ?? nameplate_load_config();
    $html = is_array($cfg['html'] ?? null) ? $cfg['html'] : [];
    $configured = trim((string) ($html['chromiumPath'] ?? ''));
    if ($configured !== '' && is_executable($configured)) {
        return $configured;
    }

    foreach (['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'] as $candidate) {
        if (is_executable($candidate)) {
            return $candidate;
        }
    }

    throw new RuntimeException('Chromium not found: install chromium in PHP image or set html.chromiumPath');
}

/** @return array{0: float, 1: float} Label size in mm from html config (default 58x20). */
function nameplate_html_page_size_mm(?array $config = null): array
{
    $cfg = $config ?? nameplate_load_config();
    $html = is_array($cfg['html'] ?? null) ? $cfg['html'] : [];
    $w = (float) ($html['pageWidthMm'] ?? 58);
    $h = (float) ($html['pageHeightMm'] ?? 20);
    if ($w < 10.0) {
        $w = 58.0;
    }
    if ($h < 5.0) {
        $h = 20.0;
    }

    return [$w, $h];
}

function nameplate_html_raster_dpi(?array $config = null): int
{
    $cfg = $config ?? nameplate_load_config();
    $html = is_array($cfg['html'] ?? null) ? $cfg['html'] : [];
    $dpi = (int) ($html['dpi'] ?? 0);
    if ($dpi <= 0) {
        $dpi = nameplate_tspl_dpi($cfg);
    }

    return $dpi > 0 ? $dpi : 203;
}

/**
 * Server-side QR as PNG bytes (TCPDF barcode → Imagick PNG).
 * Used by the raster print path; full-label PDF is not required.
 */
function nameplate_qr_png_bytes(string $text, int $px = 136): string
{
    $text = trim($text);
    if ($text === '') {
        throw new InvalidArgumentException('Empty QR payload');
    }
    $px = max(32, min(512, $px));
    if (!class_exists('Imagick')) {
        throw new RuntimeException('Imagick is required for QR PNG');
    }

    $autoload = dirname(__DIR__, 2) . '/vendor/autoload.php';
    if (is_readable($autoload)) {
        require_once $autoload;
    }
    if (!class_exists('TCPDF')) {
        throw new RuntimeException('TCPDF is required for QR generation');
    }

    $mm = round($px * 25.4 / 203.0, 3);
    $pdf = new TCPDF('L', 'mm', [$mm, $mm], true, 'UTF-8', false);
    $pdf->setPrintHeader(false);
    $pdf->setPrintFooter(false);
    $pdf->SetMargins(0, 0, 0);
    $pdf->SetAutoPageBreak(false, 0);
    $pdf->AddPage();
    $style = [
        'border' => false,
        'padding' => 0,
        'fgcolor' => [0, 0, 0],
        'bgcolor' => [255, 255, 255],
    ];
    $pdf->write2DBarcode($text, 'QRCODE,H', 0, 0, $mm, $mm, $style, 'N');
    $pdfBytes = $pdf->Output('', 'S');
    if (!is_string($pdfBytes) || $pdfBytes === '') {
        throw new RuntimeException('Failed to build QR PDF');
    }

    $im = new Imagick();
    $im->setResolution(203, 203);
    $im->readImageBlob($pdfBytes);
    $im->setIteratorIndex(0);
    $im->setImageFormat('png');
    $im->setImageBackgroundColor('white');
    if (defined('Imagick::LAYERMETHOD_FLATTEN')) {
        $flat = $im->mergeImageLayers(Imagick::LAYERMETHOD_FLATTEN);
        $im->clear();
        $im->destroy();
        $im = $flat;
    }
    $im->resizeImage($px, $px, Imagick::FILTER_POINT, 1, false);
    $png = $im->getImageBlob();
    $im->clear();
    $im->destroy();
    if (!is_string($png) || $png === '') {
        throw new RuntimeException('Failed to rasterize QR');
    }

    return $png;
}

/**
 * Server-side QR as PNG data URL (TCPDF barcode -> Imagick PNG).
 */
function nameplate_qr_png_data_url(string $text, int $px = 136): string
{
    return 'data:image/png;base64,' . base64_encode(nameplate_qr_png_bytes($text, $px));
}

/**
 * Fill HTML template; keys in $rawKeys are inserted without htmlspecialchars (e.g. data URLs).
 *
 * @param array<string, string> $context
 * @param list<string> $rawKeys
 */
function nameplate_fill_template_ex(string $html, array $context, array $rawKeys = []): string
{
    $rawSet = [];
    foreach ($rawKeys as $k) {
        $rawSet[(string) $k] = true;
    }
    $out = $html;
    foreach ($context as $key => $value) {
        $key = (string) $key;
        $str = (string) $value;
        if (!isset($rawSet[$key])) {
            $str = htmlspecialchars($str, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        }
        $out = str_replace('{{' . $key . '}}', $str, $out);
    }

    return $out;
}

/**
 * Prepare filled HTML for Chromium raster: QR img, no auto-print scripts.
 *
 * @param array<string, string> $context
 */
function nameplate_prepare_html_for_raster(string $html, array $context, ?array $config = null): string
{
    $cfg = $config ?? nameplate_load_config();
    $serial = (string) ($context['serial'] ?? '');
    $qrPx = (int) round(8.5 * nameplate_html_raster_dpi($cfg) / 25.4);
    $ctx = $context;
    $ctx['qrDataUrl'] = nameplate_qr_png_data_url($serial !== '' ? $serial : '0', max(64, $qrPx));

    $filled = nameplate_fill_template_ex($html, $ctx, ['qrDataUrl']);

    $filled = preg_replace('#<script\b[^>]*>.*?</script>#is', '', $filled) ?? $filled;
    $filled = preg_replace('#<script\b[^>]*src=["\'][^"\']*qrcode[^"\']*["\'][^>]*>\s*</script>#is', '', $filled) ?? $filled;

    if (!str_contains($filled, $ctx['qrDataUrl']) && str_contains($filled, 'id="qrBox"')) {
        $img = '<img src="' . $ctx['qrDataUrl'] . '" alt="" width="' . $qrPx . '" height="' . $qrPx . '">';
        $filled = preg_replace(
            '#(<div[^>]*id=["\']qrBox["\'][^>]*>)(.*?)(</div>)#is',
            '$1' . $img . '$3',
            $filled,
            1
        ) ?? $filled;
    }

    $rasterCss = <<<'CSS'
<style id="nameplate-raster-css">
html, body {
  margin: 0 !important;
  padding: 0 !important;
  background: #fff !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
@media screen {
  html, body {
    width: auto !important;
    height: auto !important;
    min-height: 0 !important;
    display: block !important;
    padding: 0 !important;
    background: #fff !important;
  }
  .plate {
    box-shadow: none !important;
  }
}
</style>
CSS;
    if (stripos($filled, '</head>') !== false) {
        $filled = preg_replace('#</head>#i', $rasterCss . '</head>', $filled, 1) ?? ($rasterCss . $filled);
    } else {
        $filled = $rasterCss . $filled;
    }

    return $filled;
}

/**
 * Inject geometry so the plate fills the Chromium window in CSS millimetres.
 *
 * @return array{0:string,1:int,2:int} html, captureW, captureH (CSS px @96dpi)
 */
function nameplate_html_inject_screenshot_geometry(string $html, float $widthMm, float $heightMm): array
{
    $cssDpi = 96.0;
    $captureW = max(1, (int) round($widthMm * $cssDpi / 25.4));
    $captureH = max(1, (int) round($heightMm * $cssDpi / 25.4));
    $wMm = rtrim(rtrim(number_format($widthMm, 3, '.', ''), '0'), '.');
    $hMm = rtrim(rtrim(number_format($heightMm, 3, '.', ''), '0'), '.');

    $css = <<<CSS
<style id="nameplate-screenshot-geometry">
html, body {
  width: {$captureW}px !important;
  height: {$captureH}px !important;
  margin: 0 !important;
  padding: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
  background: #fff !important;
  display: block !important;
}
body {
  display: block !important;
  align-items: stretch !important;
  justify-content: flex-start !important;
  padding: 0 !important;
}
.plate {
  width: {$wMm}mm !important;
  height: {$hMm}mm !important;
  margin: 0 !important;
  box-shadow: none !important;
  overflow: hidden !important;
  transform: none !important;
}
.qr-wrap, .qr-wrap img, .qr-wrap canvas {
  width: 8.5mm !important;
  height: 8.5mm !important;
}
</style>
CSS;
    if (stripos($html, '</head>') !== false) {
        $html = preg_replace('#</head>#i', $css . '</head>', $html, 1) ?? ($css . $html);
    } else {
        $html = $css . $html;
    }

    return [$html, $captureW, $captureH];
}

/**
 * Stretch PNG to exact print size; if artwork sits in a corner with large white
 * margins, crop to ink first so the label fills the sticker.
 */
function nameplate_png_fit_print_size(string $pngBytes, int $printW, int $printH): string
{
    if (!class_exists('Imagick')) {
        return $pngBytes;
    }

    $im = new Imagick();
    $im->readImageBlob($pngBytes);
    $im->setImageBackgroundColor('white');
    $im->setImageAlphaChannel(Imagick::ALPHACHANNEL_REMOVE);
    if (defined('Imagick::LAYERMETHOD_FLATTEN')) {
        $flat = $im->mergeImageLayers(Imagick::LAYERMETHOD_FLATTEN);
        $im->clear();
        $im->destroy();
        $im = $flat;
    }

    $srcW = max(1, $im->getImageWidth());
    $srcH = max(1, $im->getImageHeight());

    // Find ink bounding box (ignore near-white).
    $pixels = $im->exportImagePixels(0, 0, $srcW, $srcH, 'I', Imagick::PIXEL_CHAR);
    $minX = $srcW;
    $minY = $srcH;
    $maxX = -1;
    $maxY = -1;
    if (is_array($pixels)) {
        for ($y = 0; $y < $srcH; $y += 1) {
            for ($x = 0; $x < $srcW; $x += 1) {
                if ((int) ($pixels[($y * $srcW) + $x] ?? 255) < 245) {
                    if ($x < $minX) {
                        $minX = $x;
                    }
                    if ($x > $maxX) {
                        $maxX = $x;
                    }
                    if ($y < $minY) {
                        $minY = $y;
                    }
                    if ($y > $maxY) {
                        $maxY = $y;
                    }
                }
            }
        }
    }

    if ($maxX >= $minX && $maxY >= $minY) {
        $bw = $maxX - $minX + 1;
        $bh = $maxY - $minY + 1;
        $fill = ($bw * $bh) / ($srcW * $srcH);
        // Tiny corner artwork: crop with small pad, then stretch to label.
        if ($fill < 0.85) {
            $padX = max(2, (int) round($bw * 0.03));
            $padY = max(2, (int) round($bh * 0.03));
            $cropX = max(0, $minX - $padX);
            $cropY = max(0, $minY - $padY);
            $cropW = min($srcW - $cropX, $bw + (2 * $padX));
            $cropH = min($srcH - $cropY, $bh + (2 * $padY));
            $im->cropImage($cropW, $cropH, $cropX, $cropY);
            $im->setImagePage(0, 0, 0, 0);
        }
    }

    if ($im->getImageWidth() !== $printW || $im->getImageHeight() !== $printH) {
        $im->resizeImage($printW, $printH, Imagick::FILTER_LANCZOS, 1, false);
    }
    $im->setImageFormat('png');
    $out = $im->getImageBlob();
    $im->clear();
    $im->destroy();

    return is_string($out) ? $out : $pngBytes;
}

/**
 * Render filled HTML to PNG bytes via Chromium headless screenshot.
 */
function nameplate_html_to_png_bytes(string $htmlDocument, ?array $config = null): string
{
    $cfg = $config ?? nameplate_load_config();
    $chromium = nameplate_chromium_binary($cfg);
    [$widthMm, $heightMm] = nameplate_html_page_size_mm($cfg);
    $printDpi = nameplate_html_raster_dpi($cfg);
    $printW = max(1, (int) round($widthMm * $printDpi / 25.4));
    $printH = max(1, (int) round($heightMm * $printDpi / 25.4));

    [$htmlDocument, $captureW, $captureH] = nameplate_html_inject_screenshot_geometry(
        $htmlDocument,
        $widthMm,
        $heightMm
    );

    $tmpDir = sys_get_temp_dir() . '/nameplate-html-' . bin2hex(random_bytes(8));
    if (!mkdir($tmpDir, 0700, true) && !is_dir($tmpDir)) {
        throw new RuntimeException('Failed to create temp dir for HTML raster');
    }

    $htmlPath = $tmpDir . '/label.html';
    $pngPath = $tmpDir . '/label.png';
    try {
        if (file_put_contents($htmlPath, $htmlDocument) === false) {
            throw new RuntimeException('Failed to write temp HTML');
        }
        $fileUrl = 'file://' . $htmlPath;
        $cmd = [
            $chromium,
            '--headless=new',
            '--disable-gpu',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--hide-scrollbars',
            '--allow-file-access-from-files',
            '--force-device-scale-factor=1',
            '--default-background-color=FFFFFFFF',
            '--window-size=' . $captureW . ',' . $captureH,
            '--screenshot=' . $pngPath,
            $fileUrl,
        ];
        $descriptor = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $proc = proc_open($cmd, $descriptor, $pipes, $tmpDir, null, ['bypass_shell' => true]);
        if (!is_resource($proc)) {
            throw new RuntimeException('Failed to start Chromium');
        }
        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]) ?: '';
        $stderr = stream_get_contents($pipes[2]) ?: '';
        fclose($pipes[1]);
        fclose($pipes[2]);
        $code = proc_close($proc);
        if ($code !== 0 || !is_readable($pngPath)) {
            throw new RuntimeException(
                'Chromium screenshot failed (code ' . $code . '): '
                . trim($stderr !== '' ? $stderr : $stdout)
            );
        }
        $pngBytes = file_get_contents($pngPath);
        if (!is_string($pngBytes) || $pngBytes === '') {
            throw new RuntimeException('Empty PNG from Chromium');
        }

        return nameplate_png_fit_print_size($pngBytes, $printW, $printH);
    } finally {
        foreach ([$htmlPath, $pngPath] as $f) {
            if (is_string($f) && is_file($f)) {
                @unlink($f);
            }
        }
        @rmdir($tmpDir);
    }
}

/**
 * @param array<string, scalar|null> $data
 */
function nameplate_render_html_for_raster(array $data, ?array $config = null): string
{
    $cfg = $config ?? nameplate_load_config();
    $context = nameplate_build_context($data);
    $templatePath = nameplate_html_template_file($context['kind'], $cfg);
    if (!is_readable($templatePath)) {
        throw new RuntimeException('HTML template not found: ' . basename($templatePath));
    }
    $html = file_get_contents($templatePath);
    if (!is_string($html) || trim($html) === '') {
        throw new RuntimeException('Empty HTML template: ' . basename($templatePath));
    }

    return nameplate_prepare_html_for_raster($html, $context, $cfg);
}

/**
 * Generate PNG + TSPL from HTML template; write under nameplate-generated/.
 *
 * @param array<string, scalar|null> $data
 * @return array<string, mixed>
 */
function nameplate_generate_html_tspl_file(array $data, ?array $config = null): array
{
    $cfg = $config ?? nameplate_load_config();
    $context = nameplate_build_context($data);
    [$widthMm, $heightMm] = nameplate_html_page_size_mm($cfg);

    $htmlDoc = nameplate_render_html_for_raster($data, $cfg);
    $pngBytes = nameplate_html_to_png_bytes($htmlDoc, $cfg);
    $tspl = nameplate_png_to_tspl($pngBytes, $widthMm, $heightMm, $cfg);

    $pngName = $context['serial'] . '-' . $context['kind'] . '.png';
    $tsplName = $context['serial'] . '-' . $context['kind'] . '.tspl';
    $dir = nameplate_generated_dir();
    $pngPath = $dir . '/' . $pngName;
    $tsplPath = $dir . '/' . $tsplName;

    if (file_put_contents($pngPath, $pngBytes) === false) {
        throw new RuntimeException('Failed to save nameplate PNG');
    }
    if (file_put_contents($tsplPath, $tspl['bytes']) === false) {
        throw new RuntimeException('Failed to save nameplate TSPL');
    }

    return [
        'filename' => $pngName,
        'path' => $pngPath,
        'size' => strlen($pngBytes),
        'filled' => true,
        'mime' => 'image/png',
        'downloadUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($pngName),
        'previewUrl' => '/api/nameplate-print.php?action=preview&file=' . rawurlencode($pngName),
        'pngDownloadUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($pngName),
        'tspl' => [
            'filename' => $tsplName,
            'path' => $tsplPath,
            'size' => strlen($tspl['bytes']),
            'filled' => true,
            'mime' => 'application/octet-stream',
            'downloadUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($tsplName),
            'widthDots' => $tspl['widthDots'],
            'heightDots' => $tspl['heightDots'],
            'widthBytes' => $tspl['widthBytes'],
            'dpi' => nameplate_tspl_dpi($cfg),
        ],
        'html' => $htmlDoc,
        'pageWidthMm' => $widthMm,
        'pageHeightMm' => $heightMm,
    ];
}
