<?php
declare(strict_types=1);

const PASSPORT_TM07_TEMPLATE_TITLE =
    'Корректор объема газа ТМ-07 (И4; ГК; 3м; ПАД(0,08-0,2)+УК; 1,5м;ПТГ(4-60)+УК(1/4NPT-105);1,5м; ±0,27%; Ксж-2; ППД(0-4)+УК;1.5м; ПТТП(4-60)+УК(М14-80);1,5м)';

const PASSPORT_PKTM_TEMPLATE_TITLE =
    "Комплекс промышленного учета газа ПК-ТМ-Р1.БТ\u{00A0}(DN80;\u{00A0}0,65-160\u{00A0}(1:250);\u{00A0}слева направ\u{043E};\u{00A0}О;\u{00A0}Ксж-2; ПАД(0,08-0,2); ПТГ(4-60); ППД(0-4); ПТТП(4-60); БТ1)";

function passport_repo_root(): string
{
    return dirname(__DIR__, 2);
}

function passport_templates_dir(): string
{
    return passport_repo_root() . '/data/passport-templates';
}

function passport_generated_dir(): string
{
    $dir = passport_repo_root() . '/data/passport-generated';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    return $dir;
}

function passport_sanitize_filename(string $name): string
{
    $name = preg_replace('/[^\p{L}\p{N}\-_. ]+/u', '_', $name) ?? 'passport';
    $name = trim(preg_replace('/\s+/u', '_', $name) ?? 'passport', '._');
    return $name !== '' ? $name : 'passport';
}

function passport_xml_escape(string $text): string
{
    return htmlspecialchars($text, ENT_XML1 | ENT_COMPAT, 'UTF-8');
}

/** Первое непустое значение (?? не подходит — пустая строка из JS тоже «есть»). */
function passport_first_nonempty(string ...$values): string
{
    foreach ($values as $v) {
        $t = trim($v);
        if ($t !== '') {
            return $t;
        }
    }
    return '';
}

/** Не затираем полную строку из шаблона коротким обозначением из п.200 (кроме полного текста из 1С). */
function passport_should_replace_title(string $templateTitle, string $newTitle, bool $fromOrder = false): bool
{
    $newTitle = trim($newTitle);
    if ($newTitle === '' || $newTitle === $templateTitle) {
        return false;
    }
    if ($fromOrder && mb_strlen($newTitle) >= 24) {
        return true;
    }
    if (mb_strlen($newTitle) < (int) (mb_strlen($templateTitle) * 0.75)) {
        return false;
    }
    return true;
}

/** @return list<array{0:string,1:string}> */
function passport_build_tm07_replacements(array $data): array
{
    $serial = trim((string) ($data['correctorSerial'] ?? ''));
    if ($serial === '') {
        throw new InvalidArgumentException('correctorSerial обязателен для паспорта ТМ-07');
    }

    $date = trim((string) ($data['manufactureDate'] ?? date('d.m.Y')));
    $title = trim((string) ($data['correctorTitle'] ?? ''));

    $pairs = [
        ['3002603002', $serial],
        ['18.03.2026', $date],
    ];
    $titleFromOrder = !empty($data['titleFromOrder']);
    if (passport_should_replace_title(PASSPORT_TM07_TEMPLATE_TITLE, $title, $titleFromOrder)) {
        $pairs[] = [PASSPORT_TM07_TEMPLATE_TITLE, $title];
    }

    $sensors = is_array($data['sensors'] ?? null) ? $data['sensors'] : [];
    $sensorSeeds = [
        'pad' => '24428835',
        'ptg' => '8772',
        'ppd' => '25104889',
        'pttp' => '8800',
    ];
    foreach ($sensorSeeds as $key => $seed) {
        $val = trim((string) ($sensors[$key] ?? ''));
        // Нет датчика в заказе / незаполнено — в паспорт ставим «-» вместо шаблонного S/N.
        if ($val === '') {
            $val = '-';
        }
        $pairs[] = [$seed, $val];
    }

    $verifyDate = passport_first_nonempty(
        (string) ($data['verifyDateMeter'] ?? ''),
        (string) ($data['verifyDate'] ?? ''),
        $date
    );
    $pairs = array_merge($pairs, passport_verification_text_replacements($data, $verifyDate));
    $pairs = array_merge($pairs, passport_acceptance_signer_replacements($data));

    return $pairs;
}

/** @return list<array{0:string,1:string}> */
function passport_build_pkm_replacements(array $data): array
{
    $complexSerial = trim((string) ($data['complexSerial'] ?? ''));
    if ($complexSerial === '') {
        throw new InvalidArgumentException('complexSerial обязателен для паспорта ПК-ТМ');
    }

    $correctorSerial = trim((string) ($data['correctorSerial'] ?? ''));
    $date = trim((string) ($data['manufactureDate'] ?? date('d.m.Y')));
    $title = trim((string) ($data['complexTitle'] ?? ''));

    $pairs = [
        ['_4002603002_', $complexSerial],
        ['4002603002', $complexSerial],
        ['__18.03.2026__', $date],
        ['18.03.2026', $date],
    ];
    $titleFromOrder = !empty($data['titleFromOrder']);
    if (passport_should_replace_title(PASSPORT_PKTM_TEMPLATE_TITLE, $title, $titleFromOrder)) {
        $pairs[] = [PASSPORT_PKTM_TEMPLATE_TITLE, $title];
    }

    if ($correctorSerial !== '') {
        $pairs[] = ['3002603002', $correctorSerial];
    }

    $meterSerial = trim((string) ($data['meterSerial'] ?? ''));
    if ($meterSerial !== '') {
        $pairs[] = ['6001', $meterSerial];
    }

    $meterNote = trim((string) ($data['meterNote'] ?? ''));
    if ($meterNote !== '' && $meterNote !== 'ЭМИС-РГС 245   G100') {
        $pairs[] = ['ЭМИС-РГС 245   G100', $meterNote];
    }

    $telemetrySerial = trim((string) ($data['telemetrySerial'] ?? ''));
    if ($telemetrySerial === '') {
        $telemetrySerial = '-';
    }
    $pairs[] = ['412508040', $telemetrySerial];

    $telemetryName = trim((string) ($data['telemetryName'] ?? ''));
    // Наименование БТ подставляем, если в шаблоне есть типичный placeholder (опционально).
    if ($telemetryName !== '' && $telemetryName !== '-') {
        foreach ([
            'БПЭК-02/ЦК Б',
            'БПЭК-02/ЦК',
            'БПЭК-04/ЦК Б',
            'БПЭК-04/ЦК',
            'БПЭК-05/ЦК',
            'БП7К-02/ЦК Б',
            'БП7К-04/ЦК Б',
            'БП7К-05/ЦК',
            'TM-02/ТМ',
        ] as $seedName) {
            if ($telemetryName !== $seedName) {
                $pairs[] = [$seedName, $telemetryName];
            }
        }
    }

    $verifyDate = passport_first_nonempty(
        (string) ($data['verifyDateComplex'] ?? ''),
        (string) ($data['verifyDate'] ?? ''),
        $date
    );
    $pairs = array_merge($pairs, passport_verification_text_replacements($data, $verifyDate));
    $pairs = array_merge($pairs, passport_acceptance_signer_replacements($data));

    return $pairs;
}

/** @return list<array{0:string,1:string}> */
function passport_verification_text_replacements(array $data, string $verifyDate): array
{
    $pairs = [];
    $verifier = trim((string) ($data['verifierName'] ?? ''));
    if ($verifyDate !== '') {
        $filled =
            'Дата первичной поверки ' . $verifyDate
            . ($verifier !== '' ? '    Поверитель ' . $verifier : '    Поверитель __________________')
            . '    Подпись _________________';
        // Шаблоны ТМ-07 и ПК-ТМ отличаются числом подчёркиваний у «Подпись».
        $pairs[] = [
            'Дата первичной поверки __________________Поверитель______________________Подпись_________________',
            $filled,
        ];
        $pairs[] = [
            'Дата первичной поверки __________________Поверитель______________________Подпись__________________________',
            $filled . '_________',
        ];
    }
    return $pairs;
}

/** «Приёмку выполнил» — ФИО оператора (и для корректора, и для комплекса). */
function passport_acceptance_signer_replacements(array $data): array
{
    $signer = passport_first_nonempty(
        (string) ($data['commissionPerson'] ?? ''),
        (string) ($data['verifierName'] ?? '')
    );
    if ($signer === '') {
        return [];
    }
    return [
        [
            'Приёмку выполнил __________________________М.П.______________________',
            'Приёмку выполнил ' . $signer . '    М.П.______________________',
        ],
    ];
}

function passport_inject_text_into_paragraph(string $paragraphXml, string $text): string
{
    if ($text === '') {
        return $paragraphXml;
    }
    if (preg_match('/<w:t(?:\s[^>]*)?>/', $paragraphXml)) {
        $done = false;
        $out = preg_replace_callback(
            '/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/',
            static function (array $m) use ($text, &$done): string {
                if ($done) {
                    return $m[1] . $m[3];
                }
                $done = true;
                return $m[1] . passport_xml_escape($text) . $m[3];
            },
            $paragraphXml,
            1
        );
        return is_string($out) ? $out : $paragraphXml;
    }
    $run =
        '<w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t>'
        . passport_xml_escape($text) . '</w:t></w:r>';
    return str_replace('</w:p>', $run . '</w:p>', $paragraphXml);
}

function passport_set_cell_text(string $cellXml, string $text): string
{
    if ($text === '') {
        return $cellXml;
    }
    $done = false;
    $out = preg_replace_callback(
        '/<w:p\b[^>]*>.*?<\/w:p>/s',
        static function (array $m) use ($text, &$done): string {
            if ($done) {
                return $m[0];
            }
            $done = true;
            return passport_inject_text_into_paragraph($m[0], $text);
        },
        $cellXml,
        1
    );
    return is_string($out) ? $out : $cellXml;
}

/** @param list<string> $values */
function passport_fill_table_row(string $tableXml, int $rowIndex, array $values): string
{
    if (!preg_match_all('/<w:tr\b[^>]*>.*?<\/w:tr>/s', $tableXml, $rowMatches)) {
        return $tableXml;
    }
    $rows = $rowMatches[0];
    if (!isset($rows[$rowIndex])) {
        return $tableXml;
    }
    $rowXml = $rows[$rowIndex];
    if (!preg_match_all('/<w:tc\b[^>]*>.*?<\/w:tc>/s', $rowXml, $cellMatches)) {
        return $tableXml;
    }
    $cells = $cellMatches[0];
    $newRow = $rowXml;
    foreach ($cells as $ci => $cellXml) {
        if (!isset($values[$ci])) {
            continue;
        }
        $val = trim((string) $values[$ci]);
        if ($val === '') {
            continue;
        }
        $newCell = passport_set_cell_text($cellXml, $val);
        $newRow = str_replace($cellXml, $newCell, $newRow);
    }
    return str_replace($rowXml, $newRow, $tableXml);
}

function passport_table_plain(string $tableXml): string
{
    if (!preg_match_all('/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/', $tableXml, $m)) {
        return '';
    }
    return implode('', $m[1]);
}

function passport_apply_verification_tables(string $xml, array $data, string $kind): string
{
    $manufacture = trim((string) ($data['manufactureDate'] ?? ''));
    $fallback = passport_first_nonempty(
        (string) ($data['verifyDate'] ?? ''),
        $manufacture
    );
    if ($kind === 'pk-tm') {
        $verifyDate = passport_first_nonempty(
            (string) ($data['verifyDateComplex'] ?? ''),
            $fallback
        );
    } else {
        $verifyDate = passport_first_nonempty(
            (string) ($data['verifyDateMeter'] ?? ''),
            $fallback
        );
    }
    $verifyInfo = trim((string) ($data['verifyInfo'] ?? 'Первичная поверка'));
    if ($verifyInfo === '') {
        $verifyInfo = 'Первичная поверка';
    }
    $verifier = trim((string) ($data['verifierName'] ?? ''));
    $commissionDate = passport_first_nonempty(
        (string) ($data['commissionDate'] ?? ''),
        $manufacture,
        $verifyDate
    );
    $organization = trim((string) ($data['organizationName'] ?? ''));
    $commissionPerson = passport_first_nonempty(
        (string) ($data['commissionPerson'] ?? ''),
        $verifier
    );

    if ($verifyDate === '' && $commissionDate === '' && $organization === '') {
        return $xml;
    }

    return preg_replace_callback(
        '/<w:tbl\b[^>]*>.*?<\/w:tbl>/s',
        static function (array $m) use (
            $verifyDate,
            $verifyInfo,
            $verifier,
            $commissionDate,
            $organization,
            $commissionPerson
        ): string {
            $tbl = $m[0];
            $plain = passport_table_plain($tbl);
            if (str_contains($plain, 'Дата поверки') && str_contains($plain, 'Знак поверки')) {
                return passport_fill_table_row($tbl, 1, [
                    $verifyDate,
                    $verifyInfo,
                    '',
                    $verifier,
                    '',
                ]);
            }
            if (str_contains($plain, 'Наименование организации') && str_contains($plain, 'ФИО')) {
                return passport_fill_table_row($tbl, 1, [
                    $commissionDate,
                    $organization,
                    $commissionPerson,
                    '',
                ]);
            }
            return $tbl;
        },
        $xml
    ) ?? $xml;
}

function passport_apply_replacements(string $text, array $replacements): string
{
    $new = $text;
    foreach ($replacements as $pair) {
        if (!is_array($pair) || count($pair) < 2) {
            continue;
        }
        $from = (string) $pair[0];
        $to = (string) $pair[1];
        if ($from === '' || $to === $from) {
            continue;
        }
        $new = str_replace($from, $to, $new);
    }
    return $new;
}

/** Замена текста внутри w:p без DOMDocument (сохраняет исходный XML Word). */
function passport_replace_paragraph_xml(string $paragraphXml, array $replacements): string
{
    if (!preg_match_all('/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/', $paragraphXml, $matches)) {
        return $paragraphXml;
    }

    $full = implode('', $matches[1]);
    $new = passport_apply_replacements($full, $replacements);
    if ($new === $full) {
        return $paragraphXml;
    }

    $idx = 0;
    return preg_replace_callback(
        '/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/',
        static function (array $m) use (&$idx, $new): string {
            if ($idx === 0) {
                $idx += 1;
                return $m[1] . passport_xml_escape($new) . $m[3];
            }
            $idx += 1;
            return $m[1] . $m[3];
        },
        $paragraphXml
    ) ?? $paragraphXml;
}

/**
 * Замена только в «своих» w:t абзаца (не во вложенных w:p — textbox/drawing).
 * Нужно для п.8 паспорта: название из заказа в абзаце поверки лежит рядом с вложенными «Данные прибора».
 *
 * @param list<array{0:string,1:string}> $replacements
 */
function passport_replace_paragraph_own_runs(string $paragraphXml, array $replacements): string
{
    if ($replacements === []) {
        return $paragraphXml;
    }

    // Диапазоны вложенных w:p (относительно этого абзаца).
    $nested = [];
    $stack = [];
    if (preg_match_all('/<\/?w:p\b[^>]*>/', $paragraphXml, $tagMatches, PREG_OFFSET_CAPTURE)) {
        foreach ($tagMatches[0] as $i => $tm) {
            $tag = $tm[0];
            $pos = (int) $tm[1];
            if (str_starts_with($tag, '</')) {
                if ($stack === []) {
                    continue;
                }
                $start = array_pop($stack);
                // Пропускаем сам внешний абзац (первая пара open/close на глубине 0 после open).
                if ($stack !== []) {
                    $nested[] = [$start, $pos + strlen($tag)];
                }
            } else {
                $stack[] = $pos;
            }
        }
    }

    $inNested = static function (int $offset) use ($nested): bool {
        foreach ($nested as [$a, $b]) {
            if ($offset >= $a && $offset < $b) {
                return true;
            }
        }
        return false;
    };

    if (!preg_match_all('/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/', $paragraphXml, $matches, PREG_OFFSET_CAPTURE)) {
        return $paragraphXml;
    }

    $ownTexts = [];
    $ownOffsets = [];
    foreach ($matches[0] as $i => $fullMatch) {
        $offset = (int) $fullMatch[1];
        if ($inNested($offset)) {
            continue;
        }
        $ownTexts[] = $matches[1][$i][0];
        $ownOffsets[] = $offset;
    }
    if ($ownTexts === []) {
        return $paragraphXml;
    }

    $full = implode('', $ownTexts);
    $new = passport_apply_replacements($full, $replacements);
    if ($new === $full) {
        return $paragraphXml;
    }

    // Кладём новый текст в первый «свой» w:t, остальные свои очищаем.
    $firstDone = false;
    $out = '';
    $cursor = 0;
    foreach ($matches[0] as $i => $fullMatch) {
        $raw = $fullMatch[0];
        $offset = (int) $fullMatch[1];
        $out .= substr($paragraphXml, $cursor, $offset - $cursor);
        if ($inNested($offset)) {
            $out .= $raw;
        } elseif (!$firstDone) {
            $firstDone = true;
            if (preg_match('/^(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)$/', $raw, $mm)) {
                $out .= $mm[1] . passport_xml_escape($new) . $mm[3];
            } else {
                $out .= $raw;
            }
        } else {
            if (preg_match('/^(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)$/', $raw, $mm)) {
                $out .= $mm[1] . $mm[3];
            } else {
                $out .= $raw;
            }
        }
        $cursor = $offset + strlen($raw);
    }
    $out .= substr($paragraphXml, $cursor);
    return $out;
}

/**
 * Обход всех w:p стеком (в т.ч. внешние абзацы с textbox) — regex .*? их режет на первом </w:p>.
 *
 * @param list<array{0:string,1:string}> $replacements
 */
function passport_replace_in_xml(string $xml, array $replacements): string
{
    if ($replacements === []) {
        return $xml;
    }

    if (!preg_match_all('/<\/?w:p\b[^>]*>/', $xml, $tagMatches, PREG_OFFSET_CAPTURE)) {
        return $xml;
    }

    /** @var list<array{0:int,1:int}> $ranges start,end inclusive of closing tag */
    $ranges = [];
    $stack = [];
    foreach ($tagMatches[0] as $tm) {
        $tag = $tm[0];
        $pos = (int) $tm[1];
        if (str_starts_with($tag, '</')) {
            if ($stack === []) {
                continue;
            }
            $start = array_pop($stack);
            $ranges[] = [$start, $pos + strlen($tag)];
        } else {
            $stack[] = $pos;
        }
    }

    // Изнутри наружу — сначала вложенные «Данные прибора», потом абзац с названием заказа.
    usort(
        $ranges,
        static function (array $a, array $b): int {
            $lenA = $a[1] - $a[0];
            $lenB = $b[1] - $b[0];
            if ($lenA === $lenB) {
                return $b[0] <=> $a[0];
            }
            return $lenA <=> $lenB;
        }
    );

    // Пересобираем документ слева направо с учётом уже заменённых кусков.
    // Проще: применяем замены к копии, идя с конца файла чтобы оффсеты не плыли.
    usort(
        $ranges,
        static function (array $a, array $b): int {
            return $b[0] <=> $a[0];
        }
    );

    $out = $xml;
    foreach ($ranges as [$start, $end]) {
        $para = substr($out, $start, $end - $start);
        $updated = passport_replace_paragraph_own_runs($para, $replacements);
        if ($updated !== $para) {
            $out = substr($out, 0, $start) . $updated . substr($out, $end);
        }
    }
    return $out;
}

/** @param list<array{0:string,1:string}> $replacements */
function passport_fill_docx(string $templatePath, array $replacements, string $outputPath, array $data = [], string $kind = ''): void
{
    if (!is_readable($templatePath)) {
        throw new RuntimeException('Шаблон паспорта не найден: ' . basename($templatePath));
    }

    $tmp = tempnam(sys_get_temp_dir(), 'passport_');
    if ($tmp === false || !copy($templatePath, $tmp)) {
        throw new RuntimeException('Не удалось подготовить временный DOCX');
    }

    $zip = new ZipArchive();
    if ($zip->open($tmp) !== true) {
        @unlink($tmp);
        throw new RuntimeException('Не удалось открыть DOCX');
    }

    $parts = ['word/document.xml'];
    for ($i = 1; $i <= 3; $i++) {
        $parts[] = 'word/header' . $i . '.xml';
        $parts[] = 'word/footer' . $i . '.xml';
    }

    foreach ($parts as $part) {
        $content = $zip->getFromName($part);
        if ($content === false) {
            continue;
        }
        $updated = passport_replace_in_xml($content, $replacements);
        if ($part === 'word/document.xml' && $data !== []) {
            $updated = passport_apply_verification_tables($updated, $data, $kind);
        }
        if ($updated !== $content) {
            $zip->deleteName($part);
            $zip->addFromString($part, $updated);
        }
    }

    $zip->close();

    $dir = dirname($outputPath);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    if (!rename($tmp, $outputPath)) {
        @unlink($tmp);
        throw new RuntimeException('Не удалось сохранить паспорт');
    }
}

/**
 * @return array{path:string, filename:string, kind:string}
 */
function passport_generate_file(string $kind, array $data): array
{
    $kind = strtolower(trim($kind));
    if ($kind === 'tm07' || $kind === '300') {
        $template = passport_templates_dir() . '/tm07.docx';
        $replacements = passport_build_tm07_replacements($data);
        $serial = trim((string) ($data['correctorSerial'] ?? 'corrector'));
        $filename = passport_sanitize_filename($serial . '_TM07_паспорт.docx');
        $outKind = 'tm07';
    } elseif ($kind === 'pk-tm' || $kind === '400' || $kind === 'pkm') {
        $template = passport_templates_dir() . '/pk-tm.docx';
        $replacements = passport_build_pkm_replacements($data);
        $serial = trim((string) ($data['complexSerial'] ?? 'complex'));
        $filename = passport_sanitize_filename($serial . '_PK-TM_паспорт.docx');
        $outKind = 'pk-tm';
    } else {
        throw new InvalidArgumentException('kind: tm07 | pk-tm');
    }

    $outputPath = passport_generated_dir() . '/' . $filename;
    passport_fill_docx($template, $replacements, $outputPath, $data, $outKind);

    return [
        'path' => $outputPath,
        'filename' => $filename,
        'kind' => $outKind,
    ];
}

/** @return list<array{path:string, filename:string, kind:string}> */
function passport_generate_auto(array $data): array
{
    $files = [];
    $correctorSerial = trim((string) ($data['correctorSerial'] ?? ''));
    $complexSerial = trim((string) ($data['complexSerial'] ?? ''));
    $complexTitle = trim((string) ($data['complexTitle'] ?? ''));
    $isComplex = $complexSerial !== '' || ($complexTitle !== '' && preg_match('/комплекс\s+промышленного/iu', $complexTitle));

    if ($isComplex && $complexSerial !== '') {
        $files[] = passport_generate_file('pk-tm', $data);
    }
    if ($correctorSerial !== '') {
        $files[] = passport_generate_file('tm07', $data);
    }
    if ($files === []) {
        throw new InvalidArgumentException('Укажите correctorSerial и/или complexSerial');
    }

    return $files;
}
