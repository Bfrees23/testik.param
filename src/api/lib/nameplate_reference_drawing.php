<?php
declare(strict_types=1);

require_once __DIR__ . '/nameplate_template_editor.php';

function nameplate_reference_drawing_pdf_basename(): string
{
    return 'tmr-754463-091-reference.pdf';
}

function nameplate_reference_drawing_pdf_path(): string
{
    return __DIR__ . '/../../data/nameplate-templates/' . nameplate_reference_drawing_pdf_basename();
}

function nameplate_reference_drawing_id(): string
{
    return 'ТМР.754463.091';
}

/**
 * Production 58×20 mm label — matches BarTender corrector-300 / physical TE200 print.
 * Drawing ТМР.754463.091: margins 2 mm, text column 38 mm, QR □13 (right inset 2 mm).
 *
 * Fills the sticker (no huge top/bottom air). Logo is a real brand mark (~3.3 mm tall).
 *
 * @return list<array<string, mixed>>
 */
function nameplate_reference_btw_layout_objects(): array
{
    $logoData = nameplate_btw_logo_data_url(false);

    $x = static fn (float $mm): float => round($mm * 1052.0 / 58.0, 1);
    $y = static fn (float $mm): float => round($mm * 364.0 / 20.0, 1);

    // Pixel-measured from «Корректор шильд произв с qr И4.pdf» as 58×20 mm.
    $textLeft = $x(2.80);
    $textW = $x(38.4);

    $qrSizeMm = 15.15;
    $qrSize = $x($qrSizeMm);
    $qrX = $x(42.30);
    $qrY = $y(0.35);

    $logoY = 0.80;
    $logoH = 4.72;
    $logoW = 18.2;

    $titleY = 6.59;
    $titleMm = 2.20;

    $specMm = 1.52;
    $specStart = 10.48;
    $specPitch = 2.05;

    $bottomMm = 1.64;
    $bottomY = 17.04;
    $serialMm = 2.03;
    $serialY = 16.35;

    return [
        [
            'id' => 'logo',
            'type' => 'image',
            'name' => 'Logo',
            'label' => 'Логотип Техномер',
            'dataField' => '',
            'visible' => true,
            'locked' => true,
            'deletable' => false,
            'zIndex' => 5,
            'x' => $textLeft,
            'y' => $y($logoY),
            'w' => $x($logoW),
            'h' => $y($logoH),
            'imageAlign' => 'top-left',
            'imageFit' => 'height',
            'imageData' => $logoData,
        ],
        [
            'id' => 'productTitleShort',
            'type' => 'text',
            'name' => 'ProductTitleShort',
            'label' => 'Название изделия',
            'dataField' => 'productTitleShort',
            'bartenderField' => 'ProductTitleShort',
            'fontFamily' => 'Liberation Sans',
            'bold' => true,
            'italic' => false,
            'visible' => true,
            'locked' => false,
            'deletable' => false,
            'zIndex' => 10,
            'x' => $textLeft,
            'y' => $y($titleY),
            'w' => $textW,
            'fontMm' => $titleMm,
            'fontPt' => round($titleMm / 0.352778, 1),
        ],
        [
            'id' => 'specLine1',
            'type' => 'text',
            'name' => 'specLine1',
            'label' => 'Строка конфигурации 1',
            'dataField' => 'specLine1',
            'bartenderField' => 'SpecLine1',
            'fontFamily' => 'Liberation Sans Narrow',
            'bold' => false,
            'x' => $textLeft,
            'y' => $y($specStart),
            'w' => $textW,
            'fontMm' => $specMm,
            'fontPt' => round($specMm / 0.352778, 1),
            'zIndex' => 20,
            'fitMinRatio' => 0.68,
        ],
        [
            'id' => 'specLine2',
            'type' => 'text',
            'name' => 'specLine2',
            'label' => 'Строка конфигурации 2',
            'dataField' => 'specLine2',
            'bartenderField' => 'SpecLine2',
            'fontFamily' => 'Liberation Sans Narrow',
            'bold' => false,
            'x' => $textLeft,
            'y' => $y($specStart + $specPitch),
            'w' => $textW,
            'fontMm' => $specMm,
            'fontPt' => round($specMm / 0.352778, 1),
            'zIndex' => 30,
            'fitMinRatio' => 0.68,
        ],
        [
            'id' => 'specLine3',
            'type' => 'text',
            'name' => 'specLine3',
            'label' => 'Строка конфигурации 3',
            'dataField' => 'specLine3',
            'bartenderField' => 'SpecLine3',
            'fontFamily' => 'Liberation Sans Narrow',
            'bold' => false,
            'x' => $textLeft,
            'y' => $y($specStart + (2.0 * $specPitch)),
            'w' => $textW,
            'fontMm' => $specMm,
            'fontPt' => round($specMm / 0.352778, 1),
            'zIndex' => 40,
            'fitMinRatio' => 0.68,
        ],
        [
            'id' => 'releaseLabel',
            'type' => 'text',
            'name' => 'releaseLabel',
            'label' => 'Выпуск',
            'dataField' => 'releaseLabel',
            'bartenderField' => 'ReleaseLabel',
            'fontFamily' => 'Liberation Sans',
            'bold' => true,
            'x' => $textLeft,
            'y' => $y($bottomY),
            'w' => $x(24.0),
            'fontMm' => $bottomMm,
            'fontPt' => round($bottomMm / 0.352778, 1),
            'zIndex' => 50,
        ],
        [
            'id' => 'serial',
            'type' => 'text',
            'name' => 'serial',
            'label' => 'Серийный номер',
            'dataField' => 'serial',
            'bartenderField' => 'Serial',
            'fontFamily' => 'Liberation Sans',
            'bold' => true,
            'centerX' => $qrX + ($qrSize / 2.0),
            'y' => $y($serialY),
            'w' => $x($qrSizeMm + 1.0),
            'fontMm' => $serialMm,
            'fontPt' => round($serialMm / 0.352778, 1),
            'align' => 'center',
            'zIndex' => 60,
        ],
        [
            'id' => 'qr',
            'type' => 'qr',
            'name' => 'qr',
            'label' => 'QR',
            'dataField' => 'serial',
            'bartenderField' => 'Serial',
            'fontFamily' => 'Liberation Sans',
            'bold' => false,
            'x' => $qrX,
            'y' => $qrY,
            'size' => $qrSize,
            'sizeMm' => $qrSizeMm,
            'zIndex' => 70,
        ],
    ];
}

/** @return array<string, mixed> */
function nameplate_editor_document_from_reference_drawing(string $kind = 'corrector'): array
{
    $k = nameplate_template_kind_key($kind);
    $doc = nameplate_editor_scratch_document($k);
    $doc['referenceDrawing'] = nameplate_reference_drawing_id();
    $doc['referencePdf'] = nameplate_reference_drawing_pdf_basename();
    $doc['referenceTemplate'] = 'corrector-300.btw';
    $doc['pageWidthMm'] = 58.0;
    $doc['pageHeightMm'] = 20.0;
    $doc['refW'] = 1052;
    $doc['refH'] = 364;
    $doc['blankCanvas'] = true;
    $doc['staticInTemplate'] = [];
    $doc['layoutSettings'] = array_merge(nameplate_editor_default_layout_settings(), [
        'marginTopMm' => 2.0,
        'marginRightMm' => 2.0,
        'marginBottomMm' => 1.5,
        'marginLeftMm' => 2.0,
        'showMarginGuides' => true,
        'snapToMargins' => true,
        'gridStepMm' => 0.5,
    ]);

    $objects = [];
    foreach (nameplate_reference_btw_layout_objects() as $def) {
        $obj = $def;
        $obj['italic'] = false;
        $obj['visible'] = true;
        if (!isset($obj['locked'])) {
            $obj['locked'] = false;
        }
        if (!isset($obj['deletable'])) {
            $obj['deletable'] = $obj['id'] !== 'logo';
        }
        $objects[] = $obj;
    }

    $doc['editorObjects'] = $objects;
    unset($doc['dynamicFields']);

    return nameplate_editor_normalize_document($doc);
}
