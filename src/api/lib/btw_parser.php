<?php
declare(strict_types=1);

function btw_templates_dir(): string
{
    $root = dirname(__DIR__, 2);
    if (is_dir($root . '/data/nameplate-templates')) {
        return $root . '/data/nameplate-templates';
    }

    return dirname($root) . '/data/nameplate-templates';
}

function btw_safe_basename(string $name): string
{
    $base = basename(str_replace('\\', '/', $name));
    if ($base === '' || $base === '.' || $base === '..') {
        throw new InvalidArgumentException('Некорректное имя файла');
    }
    if (!preg_match('/\.btw$/i', $base)) {
        throw new InvalidArgumentException('Ожидается файл с расширением .btw');
    }

    return $base;
}

/** @return list<string> */
function btw_list_template_files(): array
{
    $dir = btw_templates_dir();
    if (!is_dir($dir)) {
        return [];
    }

    $files = [];
    foreach (scandir($dir) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }
        $path = $dir . '/' . $entry;
        if (!is_file($path) || !preg_match('/\.btw$/i', $entry)) {
            continue;
        }
        $files[] = $entry;
    }

    sort($files, SORT_NATURAL | SORT_FLAG_CASE);

    return $files;
}

/** @return array<string, mixed> */
function btw_template_info(string $filename): array
{
    $safe = btw_safe_basename($filename);
    $path = btw_templates_dir() . '/' . $safe;
    if (!is_readable($path)) {
        throw new RuntimeException('Файл не найден: ' . $safe);
    }

    return [
        'name' => $safe,
        'path' => $path,
        'size' => filesize($path) ?: 0,
        'modified' => filemtime($path) ?: 0,
    ];
}

/** @return array<string, mixed> */
function btw_parse_bytes(string $data, string $sourceName = 'upload.btw'): array
{
    $size = strlen($data);
    $valid = str_contains($data, 'Bar Tender Format');

    $header = btw_extract_header($data);
    $metadata = btw_extract_metadata($data);
    $images = btw_extract_png_images($data);
    $hexPreview = btw_hex_preview($data, 256);
    $readableText = btw_extract_readable_text($data);
    $labelSpec = btw_extract_label_spec($data);

    return [
        'source' => $sourceName,
        'size' => $size,
        'valid' => $valid,
        'header' => $header,
        'metadata' => $metadata,
        'embeddedImages' => $images,
        'readableText' => $readableText,
        'labelSpec' => $labelSpec,
        'analysis' => [
            'pngCount' => count($images),
            'hasQrMarker' => stripos($data, 'QR') !== false,
            'dataEntryForms' => isset($metadata['DataEntryForms']) ? (int) $metadata['DataEntryForms'] : null,
            'templateSize' => $metadata['TemplateSize'] ?? null,
            'printer' => $metadata['Printer'] ?? ($header['printer'] ?? null),
            'title' => $metadata['Title'] ?? null,
            'labelObjectCount' => count($labelSpec['objects'] ?? []),
        ],
        'hexPreview' => $hexPreview,
        'note' => 'Текстовые объекты извлекаются из сжатого блока BarTender; координаты и размер шрифта — из превью PNG (#1).',
    ];
}

/** @return array{headerBlock: string, lines: list<string>, labelFieldsFound: bool} */
function btw_extract_readable_text(string $data): array
{
    $lines = [];
    $metaEnd = strpos($data, '</Metadata>' . "\r\n");
    if ($metaEnd !== false) {
        $headerBlock = substr($data, 0, $metaEnd + strlen('</Metadata>' . "\r\n"));
        if (is_string($headerBlock)) {
            $headerBlock = trim(str_replace("\r", '', $headerBlock));
            foreach (explode("\n", $headerBlock) as $line) {
                $line = trim($line);
                if ($line !== '' && !preg_match('/^-+$/', $line)) {
                    $lines[] = $line;
                }
            }
        }
    }

    foreach (btw_extract_metadata($data) as $key => $value) {
        if ($value !== '') {
            $lines[] = $key . ': ' . $value;
        }
    }

    $labelFieldsFound = false;
    foreach (['Serial', 'OrderNumber', 'ConfigText', 'ProductTitle', 'ReleaseLabel'] as $needle) {
        if (stripos($data, $needle) !== false) {
            $labelFieldsFound = true;
            break;
        }
    }

    return [
        'headerBlock' => isset($headerBlock) && is_string($headerBlock) ? $headerBlock : '',
        'lines' => array_values(array_unique($lines)),
        'labelFieldsFound' => $labelFieldsFound,
    ];
}

/** @return array<string, mixed> */
function btw_parse_file(string $path, string $displayName): array
{
    $data = file_get_contents($path);
    if ($data === false) {
        throw new RuntimeException('Не удалось прочитать файл');
    }

    return btw_parse_bytes($data, $displayName);
}

/** @return array<string, string|null> */
function btw_extract_header(string $data): array
{
    $pos = strpos($data, 'Bar Tender Format');
    if ($pos === false) {
        return [
            'format' => null,
            'application' => null,
            'document' => null,
            'printer' => null,
        ];
    }

    $chunk = substr($data, $pos, 4096);
    if ($chunk === false) {
        $chunk = '';
    }

    return [
        'format' => btw_match_header_line($chunk, '/^Bar Tender Format File/m'),
        'application' => btw_match_kv_line($chunk, 'Application'),
        'document' => btw_match_kv_line($chunk, 'Document'),
        'printer' => btw_match_kv_line($chunk, 'Printer'),
    ];
}

function btw_match_header_line(string $chunk, string $pattern): ?string
{
    if (preg_match($pattern, $chunk, $m)) {
        return trim($m[0]);
    }

    return null;
}

function btw_match_kv_line(string $chunk, string $key): ?string
{
    $pattern = '/^' . preg_quote($key, '/') . ':\s*(.+)$/m';
    if (preg_match($pattern, $chunk, $m)) {
        return trim($m[1]);
    }

    return null;
}

/** @return array<string, string> */
function btw_extract_metadata(string $data): array
{
    if (!preg_match('/<Metadata>(.*?)<\/Metadata>/s', $data, $m)) {
        return [];
    }

    $xml = '<Metadata>' . $m[1] . '</Metadata>';
    $prev = libxml_use_internal_errors(true);
    $doc = simplexml_load_string($xml);
    libxml_clear_errors();
    libxml_use_internal_errors($prev);

    if ($doc === false) {
        return [];
    }

    $out = [];
    foreach ($doc->children() as $child) {
        $name = $child->getName();
        $out[$name] = trim((string) $child);
    }

    return $out;
}

/** @return list<array<string, mixed>> */
function btw_extract_png_images(string $data): array
{
    $images = [];
    $offset = 0;
    $index = 0;
    $signature = "\x89PNG\r\n\x1a\n";

    while (($start = strpos($data, $signature, $offset)) !== false) {
        $iend = strpos($data, 'IEND', $start);
        if ($iend === false) {
            break;
        }
        $end = $iend + 8;
        $chunk = substr($data, $start, $end - $start);
        if ($chunk === false || $chunk === '') {
            break;
        }

        $index++;
        $images[] = [
            'index' => $index,
            'offset' => $start,
            'size' => strlen($chunk),
            'mime' => 'image/png',
            'dataUrl' => 'data:image/png;base64,' . base64_encode($chunk),
        ];
        $offset = $end;
    }

    return $images;
}

function btw_hex_preview(string $data, int $bytes = 256): string
{
    $slice = substr($data, 0, $bytes);
    if ($slice === false || $slice === '') {
        return '';
    }

    $lines = [];
    $len = strlen($slice);
    for ($i = 0; $i < $len; $i += 16) {
        $part = substr($slice, $i, 16);
        if ($part === false) {
            break;
        }
        $hex = implode(' ', str_split(bin2hex($part), 2));
        $ascii = '';
        $partLen = strlen($part);
        for ($j = 0; $j < $partLen; $j++) {
            $ord = ord($part[$j]);
            $ascii .= ($ord >= 32 && $ord <= 126) ? $part[$j] : '.';
        }
        $lines[] = sprintf('%08x  %-47s  %s', $i, $hex, $ascii);
    }

    return implode("\n", $lines);
}

/** @return list<string> */
function btw_known_field_names(): array
{
    $configPath = dirname(btw_templates_dir()) . '/nameplate-config.json';
    if (!is_readable($configPath)) {
        return [];
    }

    $raw = file_get_contents($configPath);
    if ($raw === false) {
        return [];
    }

    $config = json_decode($raw, true);
    if (!is_array($config)) {
        return [];
    }

    $bt = $config['bartender'] ?? [];
    if (!is_array($bt)) {
        return [];
    }

    $fields = [];
    foreach ($bt as $key => $value) {
        if (!is_string($key) || !str_starts_with($key, 'field') || !is_string($value) || $value === '') {
            continue;
        }
        $fields[] = $value;
    }

    return array_values(array_unique($fields));
}

/** @return array{0: float, 1: float} */
function btw_parse_template_size_mm(array $metadata): array
{
    $raw = trim((string) ($metadata['TemplateSize'] ?? '58 x 20 мм'));
    if (preg_match('/([\d.,]+)\s*[x×х]\s*([\d.,]+)/u', $raw, $m)) {
        $w = (float) str_replace(',', '.', $m[1]);
        $h = (float) str_replace(',', '.', $m[2]);

        return [$w > 0 ? $w : 58.0, $h > 0 ? $h : 20.0];
    }

    return [58.0, 20.0];
}

function btw_find_zlib_offset(string $data): ?int
{
    $pos = strpos($data, "\x78\x9c");
    if ($pos === false) {
        $pos = strpos($data, "\x78\x01");
    }
    if ($pos === false) {
        $pos = strpos($data, "\x78\xda");
    }

    return $pos === false ? null : $pos;
}

function btw_decompress_payload(string $data): ?string
{
    $offset = btw_find_zlib_offset($data);
    if ($offset === null) {
        return null;
    }

    $chunk = substr($data, $offset);
    if ($chunk === false || $chunk === '') {
        return null;
    }

    $decoded = @gzuncompress($chunk);
    if (is_string($decoded) && $decoded !== '') {
        return $decoded;
    }

    return null;
}

/** @return list<array{offset: int, text: string}> */
function btw_parse_utf16_strings(string $payload): array
{
    $len = strlen($payload);
    $out = [];
    $i = 0;

    while ($i + 4 <= $len) {
        if ($payload[$i] !== "\xff" || $payload[$i + 1] !== "\xfe") {
            $i += 1;
            continue;
        }

        $start = $i;
        $i += 2;
        $bytes = '';
        while ($i + 1 < $len) {
            if ($payload[$i] === "\xff" && $payload[$i + 1] === "\xfe") {
                break;
            }
            if ($payload[$i] === "\x00" && $payload[$i + 1] === "\x00") {
                break;
            }
            $bytes .= $payload[$i] . $payload[$i + 1];
            $i += 2;
        }

        if ($bytes !== '') {
            $text = @mb_convert_encoding($bytes, 'UTF-8', 'UTF-16LE');
            if (is_string($text) && $text !== '') {
                $out[] = ['offset' => $start, 'text' => $text];
            }
        }
    }

    return $out;
}

function btw_clean_bartender_string(string $text): string
{
    $text = preg_replace('/[\x{0E00}-\x{F8FF}\x{FEFF}\x{FFFE}\x{FF00}]/u', '', $text) ?? $text;
    $text = str_replace("\x01", '', $text);
    $text = trim($text, " \t\r\n\x00!！:ÿ");

    return trim($text);
}

/** @return list<string> */
function btw_extract_label_sample_texts(string $payload): array
{
    $samples = [];
    foreach (btw_parse_utf16_strings($payload) as $entry) {
        $text = btw_clean_bartender_string($entry['text']);
        if (!btw_is_plausible_label_text($text)) {
            continue;
        }
        $samples[] = $text;
    }

    return array_values(array_unique($samples));
}

function btw_is_plausible_label_text(string $text): bool
{
    if ($text === '' || mb_strlen($text, 'UTF-8') < 4 || mb_strlen($text, 'UTF-8') > 180) {
        return false;
    }

    if (preg_match('/^(0123456789|OnPostSerialize|Functions and Subs|Root\\.|Data Source|Box Options|Ввод данных|Образец текста)$/u', $text)) {
        return false;
    }
    if (preg_match('/^(Текст|Штрих-код|Рисунок|Серийные|Фон|Форма|Копии|Поле|Слой|Фоновый рисунок|Цвет фона)\s/u', $text)) {
        return false;
    }
    if (preg_match('/[\\\\]|FileServer|jpg$/iu', $text)) {
        return false;
    }

    $letters = preg_match_all('/[\p{L}\p{N}\s().,;\-+±%\/:]/u', $text, $m);
    $ratio = $letters / max(1, mb_strlen($text, 'UTF-8'));
    if ($ratio < 0.85) {
        return false;
    }

    return (bool) (
        preg_match('/^Корректор объ/u', $text)
        || preg_match('/^Выпуск\s+\d{2}\.\d{4}/u', $text)
        || preg_match('/^\([ИП]/u', $text)
        || preg_match('/^П[ТП][ГД]/u', $text)
        || preg_match('/^\d{10}$/', $text)
    );
}

function btw_extract_serial_sample(string $payload): string
{
    $candidates = [];
    foreach (btw_parse_utf16_strings($payload) as $entry) {
        $text = btw_clean_bartender_string($entry['text']);
        if (preg_match_all('/\b(\d{10})\b/', $text, $matches)) {
            foreach ($matches[1] as $candidate) {
                $candidates[] = $candidate;
            }
        }
    }

    foreach ($candidates as $candidate) {
        if (preg_match('/^(3002|4002)\d{6}$/', $candidate)) {
            return $candidate;
        }
    }

    foreach ($candidates as $candidate) {
        if ($candidate !== '0123456789' && $candidate !== '9999999999') {
            return $candidate;
        }
    }

    return '';
}

/** @return list<string> */
function btw_extract_label_object_names(string $payload): array
{
    $names = [];
    foreach (btw_parse_utf16_strings($payload) as $entry) {
        $text = btw_clean_bartender_string($entry['text']);
        if ($text === '') {
            continue;
        }
        if (preg_match('/^(Текст\s+\d+|Штрих-код\s+\d+|Рисунок\s+\d+|Серийные номера\s*\d*|Фон\s+\d+|Форма\s+\d+|Копии\s*\d*)$/u', $text)) {
            $names[] = $text;
        }
    }

    return array_values(array_unique($names));
}

function btw_px_to_mm(float $px, float $ref, float $pageMm): float
{
    return $ref > 0 ? ($px / $ref) * $pageMm : 0.0;
}

function btw_band_font_pt(float $bandHeightPx, float $refH, float $pageHeightMm): float
{
    if ($refH <= 0 || $bandHeightPx <= 0) {
        return 0.0;
    }

    $fontMm = ($bandHeightPx / $refH) * $pageHeightMm;

    return round(max(2.0, $fontMm / 0.352778), 1);
}

/** @return list<array<string, int|float>> */
function btw_scan_preview_text_bands(Imagick $im, int $scanRightPx): array
{
    $width = $im->getImageWidth();
    $height = $im->getImageHeight();
    $scanRightPx = min($scanRightPx, $width - 1);
    $bands = [];

    for ($y = 0; $y < $height; $y += 1) {
        $ink = 0;
        for ($x = 40; $x <= $scanRightPx; $x += 1) {
            $color = $im->getImagePixelColor($x, $y)->getColor();
            if ((int) ($color['r'] ?? 255) < 240) {
                $ink += 1;
            }
        }
        if ($ink < 25) {
            continue;
        }

        $y0 = $y;
        while ($y0 > 0) {
            $rowInk = 0;
            for ($x = 40; $x <= $scanRightPx; $x += 1) {
                $color = $im->getImagePixelColor($x, $y0 - 1)->getColor();
                if ((int) ($color['r'] ?? 255) < 240) {
                    $rowInk += 1;
                }
            }
            if ($rowInk < 10) {
                break;
            }
            $y0 -= 1;
        }

        $y1 = $y;
        while ($y1 + 1 < $height) {
            $rowInk = 0;
            for ($x = 40; $x <= $scanRightPx; $x += 1) {
                $color = $im->getImagePixelColor($x, $y1 + 1)->getColor();
                if ((int) ($color['r'] ?? 255) < 240) {
                    $rowInk += 1;
                }
            }
            if ($rowInk < 10) {
                break;
            }
            $y1 += 1;
        }

        $left = $width;
        $right = 0;
        for ($yy = $y0; $yy <= $y1; $yy += 1) {
            for ($x = 0; $x <= $scanRightPx; $x += 1) {
                $color = $im->getImagePixelColor($x, $yy)->getColor();
                if ((int) ($color['r'] ?? 255) < 240) {
                    $left = min($left, $x);
                    $right = max($right, $x);
                }
            }
        }

        if ($left > $right) {
            $y = $y1 + 2;
            continue;
        }

        $bands[] = [
            'x' => $left,
            'y' => $y0,
            'w' => $right - $left + 1,
            'h' => $y1 - $y0 + 1,
        ];
        $y = $y1 + 2;
    }

    return $bands;
}

/**
 * Extract coordinates and font sizes from embedded preview PNG #1.
 *
 * @return array<string, mixed>
 */
function btw_extract_preview_layout(string $pngBytes, float $pageWidthMm, float $pageHeightMm): array
{
    if (!class_exists('Imagick')) {
        return [
            'available' => false,
            'error' => 'Imagick недоступен для анализа превью',
        ];
    }

    $im = new Imagick();
    $im->readImageBlob($pngBytes);
    $im->trimImage(0);
    $refW = $im->getImageWidth();
    $refH = $im->getImageHeight();
    $scanRightPx = (int) round($refW * 0.72);
    $bands = btw_scan_preview_text_bands($im, $scanRightPx);

    $rows = [];
    foreach ($bands as $band) {
        if (($band['h'] ?? 0) < 8) {
            continue;
        }
        $rows[] = [
            'xPx' => (int) $band['x'],
            'yPx' => (int) $band['y'],
            'wPx' => (int) $band['w'],
            'hPx' => (int) $band['h'],
            'xMm' => round(btw_px_to_mm((float) $band['x'], (float) $refW, $pageWidthMm), 2),
            'yMm' => round(btw_px_to_mm((float) $band['y'], (float) $refH, $pageHeightMm), 2),
            'wMm' => round(btw_px_to_mm((float) $band['w'], (float) $refW, $pageWidthMm), 2),
            'fontPt' => btw_band_font_pt((float) $band['h'], (float) $refH, $pageHeightMm),
        ];
    }

    $im->clear();
    $im->destroy();

    return [
        'available' => true,
        'refWidthPx' => $refW,
        'refHeightPx' => $refH,
        'pageWidthMm' => $pageWidthMm,
        'pageHeightMm' => $pageHeightMm,
        'textBands' => $rows,
    ];
}

/**
 * Build structured label objects by combining BarTender sample text and preview layout.
 *
 * @return array<string, mixed>
 */
function btw_extract_label_spec(string $data): array
{
    $metadata = btw_extract_metadata($data);
    [$pageWidthMm, $pageHeightMm] = btw_parse_template_size_mm($metadata);
    $payload = btw_decompress_payload($data);
    $sampleTexts = is_string($payload) ? btw_extract_label_sample_texts($payload) : [];
    $objectNames = is_string($payload) ? btw_extract_label_object_names($payload) : [];

    $title = '';
    $release = '';
    $serialSample = is_string($payload) ? btw_extract_serial_sample($payload) : '';
    $specLines = [];
    foreach ($sampleTexts as $text) {
        if ($title === '' && preg_match('/^Корректор объ/u', $text)) {
            $title = $text;
            continue;
        }
        if ($release === '' && preg_match('/^Выпуск\s+\d{2}\.\d{4}/u', $text)) {
            $release = $text;
            continue;
        }
        if ($serialSample === '' && preg_match('/^\d{10}$/', $text)) {
            $serialSample = $text;
            continue;
        }
        if (preg_match('/^\([ИП]/u', $text) || preg_match('/^П[ТП][ГД]/u', $text)) {
            $specLines[] = $text;
        }
    }
    $specLines = array_values(array_unique($specLines));

    $layout = ['available' => false];
    $images = btw_extract_png_images($data);
    if ($images !== []) {
        $pngBytes = base64_decode(substr((string) $images[0]['dataUrl'], strpos((string) $images[0]['dataUrl'], ',') + 1), true);
        if (is_string($pngBytes) && $pngBytes !== '') {
            $layout = btw_extract_preview_layout($pngBytes, $pageWidthMm, $pageHeightMm);
        }
    }

    $objects = [];
    $bands = is_array($layout['textBands'] ?? null) ? $layout['textBands'] : [];

    if ($title !== '') {
        $objects[] = btw_build_label_object(
            'title',
            'ProductTitleShort',
            $title,
            btw_pick_text_band($bands, 20.0, 100.0),
            false
        );
    }

    $specBandPool = array_values(array_filter(
        $bands,
        static fn(array $band): bool => btw_band_center_y($band) >= 110.0 && btw_band_center_y($band) <= 300.0
    ));
    $specTargets = [121.0, 191.0, 262.0];

    foreach ($specLines as $idx => $line) {
        $targetY = $specTargets[$idx] ?? null;
        $band = is_float($targetY) ? btw_pick_band_near_y($specBandPool, $targetY) : ($specBandPool[$idx] ?? null);
        $objects[] = btw_build_label_object(
            'specLine' . ($idx + 1),
            'SpecLine' . ($idx + 1),
            $line,
            $band,
            true
        );
    }

    if ($release !== '') {
        $objects[] = btw_build_label_object(
            'release',
            'ReleaseLabel',
            $release,
            btw_pick_text_band($bands, 300.0, 340.0),
            true
        );
    }

    if ($serialSample !== '') {
        $objects[] = [
            'id' => 'serial',
            'role' => 'dynamic',
            'field' => 'Serial',
            'sampleText' => $serialSample,
            'text' => $serialSample,
            'layout' => [
                'centerXPx' => 898.5,
                'yPx' => 310,
                'wPx' => 305,
                'fontPt' => 3.6,
            ],
            'note' => 'Серийный номер (10 цифр), также кодируется в QR',
        ];
    } else {
        $objects[] = [
            'id' => 'serial',
            'role' => 'dynamic',
            'field' => 'Serial',
            'sampleText' => null,
            'text' => null,
            'layout' => [
                'centerXPx' => 898.5,
                'yPx' => 310,
                'wPx' => 305,
                'fontPt' => 3.6,
            ],
            'note' => 'Серийный номер (10 цифр), также кодируется в QR',
        ];
    }

    $objects[] = [
        'id' => 'qr',
        'role' => 'dynamic',
        'field' => 'Serial',
        'sampleText' => $serialSample !== '' ? $serialSample : null,
        'text' => 'QR-код',
        'layout' => [
            'xPx' => 746,
            'yPx' => 40,
            'sizePx' => 249,
            'xMm' => round(btw_px_to_mm(746.0, 1052.0, $pageWidthMm), 2),
            'yMm' => round(btw_px_to_mm(40.0, 364.0, $pageHeightMm), 2),
            'sizeMm' => round(btw_px_to_mm(249.0, 1052.0, $pageWidthMm), 2),
        ],
        'note' => 'Штрих-код 1 (QR), источник — серийный номер',
    ];

    $objects[] = [
        'id' => 'logo',
        'role' => 'static',
        'field' => null,
        'sampleText' => null,
        'text' => 'Техномер (логотип, растровый)',
        'layout' => [
            'xPx' => 75,
            'yPx' => 33,
            'wPx' => 210,
            'hPx' => 22,
        ],
        'note' => 'Рисунок 3 — файл логотипа внутри шаблона BarTender',
    ];

    return [
        'pageWidthMm' => $pageWidthMm,
        'pageHeightMm' => $pageHeightMm,
        'sampleTexts' => $sampleTexts,
        'objectNames' => $objectNames,
        'layout' => $layout,
        'objects' => $objects,
        'payloadCompressed' => is_string($payload),
        'payloadSize' => is_string($payload) ? strlen($payload) : 0,
    ];
}

/** @param array<string, int|float> $band */
function btw_band_center_y(array $band): float
{
    return (float) ($band['yPx'] ?? 0) + ((float) ($band['hPx'] ?? 0) / 2.0);
}

/** @param list<array<string, int|float>> $bands */
function btw_pick_band_near_y(array $bands, float $targetY): ?array
{
    $best = null;
    $bestDist = 9999.0;
    foreach ($bands as $band) {
        $dist = abs(btw_band_center_y($band) - $targetY);
        if ($dist < $bestDist) {
            $bestDist = $dist;
            $best = $band;
        }
    }

    return $best;
}

/** @param list<array<string, int|float>> $bands */
function btw_pick_text_band(array $bands, float $minY, float $maxY): ?array
{
    foreach ($bands as $band) {
        $center = btw_band_center_y($band);
        if ($center >= $minY && $center <= $maxY) {
            return $band;
        }
    }

    return null;
}

/** @param array<string, int|float>|null $band */
function btw_build_label_object(string $id, ?string $field, string $text, ?array $band, bool $dynamic): array
{
    $layout = null;
    if (is_array($band)) {
        $layout = [
            'xPx' => (int) ($band['xPx'] ?? 0),
            'yPx' => (int) ($band['yPx'] ?? 0),
            'wPx' => (int) ($band['wPx'] ?? 0),
            'hPx' => (int) ($band['hPx'] ?? 0),
            'xMm' => (float) ($band['xMm'] ?? 0),
            'yMm' => (float) ($band['yMm'] ?? 0),
            'wMm' => (float) ($band['wMm'] ?? 0),
            'fontPt' => (float) ($band['fontPt'] ?? 0),
        ];
    }

    return [
        'id' => $id,
        'role' => $dynamic ? 'dynamic' : 'static',
        'field' => $field,
        'text' => $text,
        'sampleText' => $text,
        'layout' => $layout,
    ];
}

/** @return array<string, mixed> */
function btw_extract_label_spec_file(string $path): array
{
    $data = file_get_contents($path);
    if ($data === false) {
        throw new RuntimeException('Не удалось прочитать .btw');
    }

    return btw_extract_label_spec($data);
}
