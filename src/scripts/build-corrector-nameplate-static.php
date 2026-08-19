#!/usr/bin/env php
<?php
declare(strict_types=1);

/**
 * Rebuild corrector-nameplate-static.png from BarTender preview (corrector-300.btw).
 * Keeps logo + title + border; blanks only dynamic print zones.
 *
 * Run: docker compose exec php php /app/scripts/build-corrector-nameplate-static.php
 */

require_once dirname(__DIR__) . '/api/lib/btw_parser.php';

$btwPath = '/app/data/nameplate-templates/corrector-300.btw';
$src = '/app/data/nameplate-templates/extracted/png1.png';
$dst = '/app/data/nameplate-templates/corrector-nameplate-static.png';

if (!is_readable($src) && is_readable($btwPath)) {
    $parsed = btw_parse_bytes(file_get_contents($btwPath) ?: '', 'corrector-300.btw');
    $dataUrl = (string) ($parsed['embeddedImages'][0]['dataUrl'] ?? '');
    $comma = strpos($dataUrl, ',');
    if ($comma !== false) {
        $png = base64_decode(substr($dataUrl, $comma + 1), true);
        if (is_string($png) && $png !== '') {
            $dir = dirname($src);
            if (!is_dir($dir)) {
                mkdir($dir, 0775, true);
            }
            file_put_contents($src, $png);
        }
    }
}

if (!is_readable($src)) {
    fwrite(STDERR, "Source not found: $src\n");
    exit(1);
}

if (!class_exists('Imagick')) {
    fwrite(STDERR, "Imagick extension required\n");
    exit(1);
}

$im = new Imagick($src);
$im->trimImage(0);
$im->setImageType(Imagick::IMGTYPE_TRUECOLOR);
$im->setImageAlphaChannel(Imagick::ALPHACHANNEL_DEACTIVATE);
$w = $im->getImageWidth();
$h = $im->getImageHeight();

$draw = new ImagickDraw();
$draw->setFillColor('white');
$draw->setStrokeColor('white');
$draw->rectangle(28, 115, (int) ($w * 0.705), 298);
$draw->rectangle(28, 305, 430, 338);
$draw->rectangle((int) ($w * 0.708), 35, $w - 6, 338);
$im->drawImage($draw);
$im->writeImage($dst);

echo "Wrote $dst ({$w}x{$h})\n";
