<?php
declare(strict_types=1);

/** @param array<string, mixed>|null $config */
function nameplate_gotenberg_url(?array $config = null): string
{
    $env = getenv('GOTENBERG_URL');
    if (is_string($env) && trim($env) !== '') {
        return rtrim(trim($env), '/');
    }
    $cfg = $config ?? nameplate_load_config();
    $gb = is_array($cfg['gotenberg'] ?? null) ? $cfg['gotenberg'] : [];
    $url = trim((string) ($gb['url'] ?? ''));

    return $url !== '' ? rtrim($url, '/') : 'http://gotenberg:3000';
}

/** @param array<string, mixed>|null $config */
function nameplate_gotenberg_enabled(?array $config = null): bool
{
    $cfg = $config ?? nameplate_load_config();
    $gb = is_array($cfg['gotenberg'] ?? null) ? $cfg['gotenberg'] : [];

    return ($gb['enabled'] ?? true) !== false;
}

/** @return array{ok:bool, url:string, error?:string} */
function nameplate_gotenberg_health(?array $config = null): array
{
    $base = nameplate_gotenberg_url($config);
    $url = $base . '/health';
    $desc = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];
    $proc = @proc_open(['curl', '-sS', '-f', '--max-time', '3', $url], $desc, $pipes);
    if (!is_resource($proc)) {
        return ['ok' => false, 'url' => $base, 'error' => 'curl недоступен'];
    }
    fclose($pipes[0]);
    $out = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $code = proc_close($proc);
    if ($code !== 0) {
        return ['ok' => false, 'url' => $base, 'error' => 'Gotenberg недоступен'];
    }

    return ['ok' => true, 'url' => $base, 'body' => is_string($out) ? $out : ''];
}

function nameplate_gotenberg_html_to_pdf(string $html, float $widthMm, float $heightMm, ?array $config = null): string
{
    if (trim($html) === '') {
        throw new RuntimeException('Пустой HTML для Gotenberg');
    }
    $w = $widthMm > 0 ? $widthMm : 58.0;
    $h = $heightMm > 0 ? $heightMm : 20.0;
    $dir = sys_get_temp_dir() . '/np-gb-' . bin2hex(random_bytes(4));
    if (!mkdir($dir, 0700) && !is_dir($dir)) {
        throw new RuntimeException('Не удалось создать временный каталог Gotenberg');
    }
    $htmlPath = $dir . '/index.html';
    if (file_put_contents($htmlPath, $html) === false) {
        throw new RuntimeException('Не удалось записать HTML для Gotenberg');
    }

    $paperW = rtrim(rtrim(sprintf('%.4F', $w / 25.4), '0'), '.');
    $paperH = rtrim(rtrim(sprintf('%.4F', $h / 25.4), '0'), '.');
    $endpoint = nameplate_gotenberg_url($config) . '/forms/chromium/convert/html';
    $cmd = [
        'curl', '-sS', '-f', '--max-time', '45',
        '-F', 'files=@' . $htmlPath . ';filename=index.html;type=text/html',
        '-F', 'paperWidth=' . $paperW,
        '-F', 'paperHeight=' . $paperH,
        '-F', 'marginTop=0',
        '-F', 'marginBottom=0',
        '-F', 'marginLeft=0',
        '-F', 'marginRight=0',
        '-F', 'printBackground=true',
        '-F', 'preferCssPageSize=true',
        '-F', 'scale=1',
        $endpoint,
    ];
    $desc = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];
    try {
        $proc = proc_open($cmd, $desc, $pipes);
        if (!is_resource($proc)) {
            throw new RuntimeException('Не удалось запустить curl для Gotenberg');
        }
        fclose($pipes[0]);
        $pdf = stream_get_contents($pipes[1]);
        $err = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $code = proc_close($proc);
        if ($code !== 0 || !is_string($pdf) || !str_starts_with($pdf, '%PDF')) {
            $hint = is_string($err) && trim($err) !== '' ? trim($err) : ('exit ' . (string) $code);
            throw new RuntimeException('Gotenberg не собрал PDF: ' . $hint);
        }

        return $pdf;
    } finally {
        @unlink($htmlPath);
        @rmdir($dir);
    }
}

/**
 * @param array<string, string> $context
 * @param array<string, mixed>|null $config
 * @return array<string, mixed>
 */
function nameplate_generate_gotenberg_pdf_file(array $context, string $pngBytes, ?array $config = null): array
{
    $cfg = $config ?? nameplate_load_config();
    $pa = is_array($cfg['printAgent'] ?? null) ? $cfg['printAgent'] : [];
    $dlg = is_array($pa['dialog'] ?? null) ? $pa['dialog'] : [];
    $wmm = (float) ($dlg['pageWidthMm'] ?? 58);
    $hmm = (float) ($dlg['pageHeightMm'] ?? 20);
    $html = nameplate_browser_print_html($pngBytes, (string) ($context['serial'] ?? ''), $wmm, $hmm);
    $html = str_replace('onload="window.print()"', '', $html);
    $pdf = nameplate_gotenberg_html_to_pdf($html, $wmm, $hmm, $cfg);

    require_once __DIR__ . '/nameplate_pdf.php';
    $filename = nameplate_pdf_filename((string) $context['serial'], (string) $context['kind']);
    $path = nameplate_generated_dir() . '/' . $filename;
    if (file_put_contents($path, $pdf) === false) {
        throw new RuntimeException('Не удалось сохранить PDF Gotenberg');
    }

    return [
        'filename' => $filename,
        'path' => $path,
        'size' => strlen($pdf),
        'filled' => true,
        'engine' => 'gotenberg',
        'mime' => 'application/pdf',
        'downloadUrl' => '/api/nameplate-print.php?action=download&file=' . rawurlencode($filename),
        'previewUrl' => '/api/nameplate-print.php?action=preview&file=' . rawurlencode($filename),
    ];
}

/**
 * @param array<string, mixed> $job
 * @param array<string, mixed> $context
 * @param array<string, mixed>|null $config
 * @param array<string, mixed>|null $png
 * @return array<string, mixed>
 */
function nameplate_job_with_gotenberg_pdf(array $job, array $context, ?array $png, ?array $config = null): array
{
    $cfg = $config ?? nameplate_load_config();
    if (!nameplate_gotenberg_enabled($cfg) || !is_array($png)) {
        return $job;
    }
    $path = (string) ($png['path'] ?? '');
    if ($path === '' || !is_readable($path)) {
        return $job;
    }
    try {
        require_once __DIR__ . '/nameplate_pdf.php';
        $hiRes = nameplate_render_corrector_raster($context);
        $pdf = nameplate_generate_gotenberg_pdf_file($context, $hiRes, $cfg);
        $job['gotenberg'] = $pdf;
        $job['pdfPreviewUrl'] = $pdf['previewUrl'];
        $job['pdfDownloadUrl'] = $pdf['downloadUrl'];
        $job['pdfFilename'] = $pdf['filename'];
    } catch (Throwable $e) {
        error_log('nameplate Gotenberg: ' . $e->getMessage());
        $job['gotenbergError'] = $e->getMessage();
    }

    return $job;
}
