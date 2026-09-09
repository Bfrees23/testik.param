#!/usr/bin/env php
<?php
declare(strict_types=1);

/**
 * Build corrector-nameplate-template.pdf from raster extracted from corrector-300.btw.
 * Static artwork (logo, ��������, title, border) stays in the PDF; dynamic zones are blanked.
 *
 * Run: docker compose exec php php /app/scripts/build-corrector-nameplate-template.php
 */

$autoload = dirname(__DIR__) . '/vendor/autoload.php';
if (!is_readable($autoload)) {
    fwrite(STDERR, "Composer vendor not found. Run: composer install -d src\n");
    exit(1);
}
require_once $autoload;

$src = '/app/data/nameplate-templates/extracted/png1.png';
$jpg = '/app/data/nameplate-templates/corrector-nameplate-template.jpg';
$dst = '/app/data/nameplate-templates/corrector-nameplate-template.pdf';
$pageW = 58.0;
$pageH = 20.0;

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
$w = $im->getImageWidth();
$h = $im->getImageHeight();

$draw = new ImagickDraw();
$draw->setFillColor('white');
$draw->setStrokeColor('white');
// Dynamic fields only � logo and brand remain in the template artwork; title is drawn on print.
$draw->rectangle(48, 53, (int) ($w * 0.705), 98);
$draw->rectangle(28, 115, (int) ($w * 0.705), 298);
$draw->rectangle(28, 305, 430, 338);
$draw->rectangle((int) ($w * 0.708), 35, $w - 6, 292);
$draw->rectangle((int) ($w * 0.708), 296, $w - 6, 338);
$im->drawImage($draw);

$im->setImageType(Imagick::IMGTYPE_TRUECOLOR);
$im->setImageFormat('jpeg');
$im->setImageCompressionQuality(96);
$im->writeImage($jpg);

$pdf = new TCPDF('L', 'mm', [$pageW, $pageH], true, 'UTF-8', false);
$pdf->SetCreator('TM-07 bench');
$pdf->SetAuthor('TM-07');
$pdf->SetTitle('Corrector nameplate template');
$pdf->setPrintHeader(false);
$pdf->setPrintFooter(false);
$pdf->SetMargins(0, 0, 0);
$pdf->SetAutoPageBreak(false, 0);
$pdf->AddPage();
$pdf->Image($jpg, 0, 0, $pageW, $pageH, 'JPEG', '', '', false, 300, '', false, false, 0);
$pdf->Output($dst, 'F');

$fieldsPath = '/app/data/nameplate-templates/corrector-nameplate-template.fields.json';
$fields = [
    'pageWidthMm' => $pageW,
    'pageHeightMm' => $pageH,
    'refW' => $w,
    'refH' => $h,
    'staticInTemplate' => ['logo', 'brand', 'border'],
    'dynamicFields' => [
        'specLine1' => ['x' => 52, 'y' => 121, 'fontMm' => 5.0, 'w' => 680],
        'specLine2' => ['x' => 55, 'y' => 191, 'fontMm' => 5.0, 'w' => 680],
        'specLine3' => ['x' => 52, 'y' => 262, 'fontMm' => 5.0, 'w' => 680],
        'releaseLabel' => ['x' => 51, 'y' => 310, 'fontMm' => 6.0, 'w' => 380],
        'serial' => ['centerX' => 898.5, 'y' => 310, 'fontMm' => 6.0, 'w' => 305, 'style' => ''],
        'qr' => ['x' => 746, 'y' => 40, 'sizeMm' => 13.0],
    ],
    'overlayFields' => [
        'productTitleShort' => ['x' => 52, 'y' => 54, 'fontMm' => 7.0, 'w' => 680, 'style' => ''],
    ],
    'referenceDrawing' => 'TMR.754463.091',
];
file_put_contents($fieldsPath, json_encode($fields, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n");

echo "Wrote $dst ({$w}x{$h} raster, {$pageW}x{$pageH} mm)\n";
echo "Wrote $fieldsPath\n";
