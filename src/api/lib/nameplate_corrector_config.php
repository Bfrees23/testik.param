<?php
declare(strict_types=1);

function nameplate_find_corrector_line(string $text): string
{
    $text = trim($text);
    if ($text === '') {
        return '';
    }
    if (preg_match('/Корректор\s+объ[её]ма\s+газа\s+ТМ-07[^.\n\r]*/ui', $text, $m)) {
        return trim($m[0]);
    }

    return '';
}

function nameplate_extract_corrector_i_block(string $text): string
{
    $text = trim($text);
    if ($text === '') {
        return '';
    }
    if (!preg_match('/\(\s*(?:\x{0418}|I)\s*[1-4]\s*;/ui', $text, $m, PREG_OFFSET_CAPTURE)) {
        return '';
    }

    $inner = nameplate_extract_paren_block($text, (int) $m[0][1]);
    if ($inner === '') {
        return '';
    }

    return nameplate_normalize_config_inner($inner);
}

function nameplate_extract_sensor_paren_block(string $text): string
{
    $text = trim($text);
    if ($text === '') {
        return '';
    }

    if (preg_match('/\(\s*DN\d+/ui', $text, $m, PREG_OFFSET_CAPTURE)) {
        $inner = nameplate_extract_paren_block($text, (int) $m[0][1]);
        if ($inner !== '' && preg_match('/(?:ПАД|ПТГ|ППД|ПТТП|Ксж-)/ui', $inner)) {
            return nameplate_normalize_config_inner($inner);
        }
    }

    $offset = 0;
    while (preg_match('/\(/u', $text, $m, PREG_OFFSET_CAPTURE, $offset)) {
        $start = (int) $m[0][1];
        $inner = nameplate_extract_paren_block($text, $start);
        $offset = $start + 1;
        if ($inner === '') {
            continue;
        }
        if (preg_match('/(?:ПАД|ПТГ|ППД|ПТТП|Ксж-)/ui', $inner)) {
            return nameplate_normalize_config_inner($inner);
        }
    }

    return '';
}

function nameplate_extract_bare_dn_config(string $text): string
{
    $text = trim($text);
    if ($text === '') {
        return '';
    }

    if (preg_match('/\b(DN\d+;.*?БТ\d+)/ui', $text, $m)) {
        return nameplate_normalize_config_inner($m[1]);
    }
    if (preg_match('/\b(DN\d+;[^.\n\r]+)/ui', $text, $m)) {
        $candidate = trim($m[1]);
        if (preg_match('/(?:ПАД|Ксж-)/ui', $candidate)) {
            return nameplate_normalize_config_inner($candidate);
        }
    }

    return '';
}

function nameplate_extract_order_config_inner(string $text): string
{
    $text = trim($text);
    if ($text === '') {
        return '';
    }

    $inner = nameplate_extract_corrector_i_block($text);
    if ($inner !== '') {
        return $inner;
    }

    $inner = nameplate_extract_sensor_paren_block($text);
    if ($inner !== '') {
        return $inner;
    }

    return nameplate_extract_bare_dn_config($text);
}

function nameplate_match_sensor_token(string $text, string $code): string
{
    $pattern = '/' . preg_quote($code, '/') . '\s*\(([^)]+)\)/ui';
    if (!preg_match($pattern, $text, $m)) {
        return '';
    }

    $range = trim($m[1]);
    if ($range === '') {
        return '';
    }

    return $code . '(' . $range . ')';
}

function nameplate_detect_corrector_execution(string $text): string
{
    if (preg_match('/\b(?:\x{0418}|I)\s*([1-4])\b/ui', $text, $m)) {
        return "И" . $m[1];
    }

    $hasPpd = (bool) preg_match('/ППД\s*\(/ui', $text);
    $hasPttp = (bool) preg_match('/ПТТП\s*\(/ui', $text);
    if ($hasPpd && $hasPttp) {
        return "И4";
    }
    if ($hasPpd) {
        return "И2";
    }
    if ($hasPttp) {
        return "И3";
    }

    return "И1";
}

function nameplate_extract_ptg_uk(string $text): string
{
    if (preg_match('/1\/4NPT-\d+/ui', $text, $m)) {
        return $m[0];
    }

    return '1/4NPT-125';
}

function nameplate_extract_pttp_uk(string $text): string
{
    if (preg_match('/М14-\d+/ui', $text, $m)) {
        return $m[0];
    }

    return 'М14-80';
}

function nameplate_extract_kszh_token(string $text): string
{
    if (preg_match('/Ксж\s*-\s*(\d+)/ui', $text, $m)) {
        return 'Ксж-' . $m[1];
    }

    return '';
}

function nameplate_convert_order_to_corrector_config(string $text): string
{
    $text = trim($text);
    if ($text === '') {
        return '';
    }

    $inner = nameplate_extract_order_config_inner($text);
    if ($inner === '') {
        return '';
    }

    $full = $text . ' ' . $inner;
    $exec = nameplate_detect_corrector_execution($full);
    $segments = [$exec . ';', 'ГК;'];

    if (preg_match('/\b3м\b/ui', $full) || $exec !== "И1") {
        $segments[] = '3м;';
    }

    $pad = nameplate_match_sensor_token($inner, 'ПАД');
    $ptg = nameplate_match_sensor_token($inner, 'ПТГ');
    $ppd = nameplate_match_sensor_token($inner, 'ППД');
    $pttp = nameplate_match_sensor_token($inner, 'ПТТП');
    $kszh = nameplate_extract_kszh_token($inner);

    if ($pad !== '') {
        $segments[] = $pad . '+УК;1,5м;';
    }
    if ($ptg !== '') {
        $segments[] = $ptg . '+УК(' . nameplate_extract_ptg_uk($full) . ');1,5м;';
    }
    if ($exec === "И4" || ($ppd !== '' && $pttp !== '')) {
        $segments[] = '±0,27%;';
    }
    if ($kszh !== '') {
        $segments[] = $kszh . ';';
    }
    if ($ppd !== '') {
        $segments[] = $ppd . '+УК;1,5м;';
    }
    if ($pttp !== '') {
        $segments[] = $pttp . '+УК(' . nameplate_extract_pttp_uk($full) . ');1,5м;';
    }

    if (count($segments) <= 2) {
        return '';
    }

    return nameplate_normalize_config_inner(implode('', $segments));
}

function nameplate_normalize_corrector_config(string $inner): string
{
    $inner = nameplate_normalize_config_inner($inner);
    if ($inner === '') {
        return '';
    }

    // Allow "(И4;…)" from the workbench — strip one outer paren pair for matching.
    if ($inner[0] === '(' && str_ends_with($inner, ')')) {
        $inner = nameplate_normalize_config_inner(substr($inner, 1, -1));
    }
    if ($inner === '') {
        return '';
    }

    if (preg_match('/^(?:\x{0418}|I)[1-4];/ui', $inner)) {
        // Already a corrector plate block (Иn;…). Keep as-is, including simple
        // forms without +УК and forms with ДД/ПД/… sensors.
        return $inner;
    }

    $converted = nameplate_convert_order_to_corrector_config($inner);
    if ($converted !== '') {
        return $converted;
    }

    $converted = nameplate_convert_order_to_corrector_config('(' . $inner . ')');

    return $converted !== '' ? $converted : $inner;
}

/** @param array<string, scalar|null> $data */
function nameplate_resolve_corrector_config_text(array $data, string $productTitle): string
{
    $configText = trim((string) ($data['configText'] ?? ''));
    if ($configText !== '') {
        $normalized = nameplate_normalize_corrector_config($configText);
        if ($normalized !== '') {
            return $normalized;
        }
    }

    $orderConfig = trim((string) ($data['orderConfig'] ?? ''));
    $correctorLine = nameplate_find_corrector_line($orderConfig);
    if ($correctorLine === '') {
        $correctorLine = nameplate_find_corrector_line($productTitle);
    }

    $sources = array_values(array_filter([
        $correctorLine,
        $orderConfig,
        $productTitle,
        trim($correctorLine . ' ' . $orderConfig),
    ]));

    foreach ($sources as $source) {
        $block = nameplate_extract_corrector_i_block($source);
        if ($block !== '') {
            return nameplate_normalize_corrector_config($block);
        }
    }

    foreach ($sources as $source) {
        $converted = nameplate_convert_order_to_corrector_config($source);
        if ($converted !== '') {
            return $converted;
        }
    }

    return '';
}
