<?php
declare(strict_types=1);

/**
 * Реестр «Номера корректоров.xlsx»:
 *   лист Корректоры — S/N 300… в колонках И1–И4, заказ в «З/П»;
 *   лист Комплексы — № корректора, № комплекса, «Заказ на производство».
 *
 * Источник истины (шара):
 *   \\srv-fs\FileServer\Production\BD_Corrector\Инструкция по выпуску корректоров\Номера корректоров.xlsx
 * PHP в Docker пишет в локальную рабочую копию data/serial/; перед чтением/после записи
 * тянем/пушим на шару через PowerShell (WSL) или напрямую, если UNC доступен.
 */

/** UNC шары — единый реестр производства. */
function serial_xlsx_unc_path(): string
{
    $env = trim((string) (getenv('TM07_SERIAL_XLSX_UNC') ?: ''));
    if ($env !== '') {
        return $env;
    }
    return '\\\\srv-fs\\FileServer\\Production\\BD_Corrector\\Инструкция по выпуску корректоров\\Номера корректоров.xlsx';
}

/** Локальная рабочая копия (Docker volume ./data/serial). */
function serial_xlsx_local_path(): string
{
    $base = defined('BASE_PATH') ? BASE_PATH : dirname(__DIR__, 2);
    return rtrim($base, '/\\') . '/data/serial/Номера корректоров.xlsx';
}

/**
 * Путь для чтения/записи в PHP.
 * Приоритет: TM07_SERIAL_XLSX → доступный UNC → локальная копия.
 */
function serial_xlsx_working_path(): string
{
    $env = trim((string) (getenv('TM07_SERIAL_XLSX') ?: ''));
    if ($env !== '') {
        return $env;
    }
    $unc = serial_xlsx_unc_path();
    if (@is_readable($unc)) {
        return $unc;
    }
    return serial_xlsx_local_path();
}

function serial_xlsx_powershell_exe(): ?string
{
    $candidates = [
        '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        'powershell.exe',
    ];
    foreach ($candidates as $p) {
        if ($p === 'powershell.exe') {
            return $p;
        }
        if (is_file($p) || is_executable($p)) {
            return $p;
        }
    }
    return null;
}

/**
 * Стянуть файл с UNC в локальную копию (через PowerShell на WSL/Windows).
 * @return bool true если локальный файл обновлён или уже актуален
 */
function serial_xlsx_pull_from_unc(): bool
{
    $unc = serial_xlsx_unc_path();
    $local = serial_xlsx_local_path();
    $dir = dirname($local);
    if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
        return false;
    }

    // Windows PHP / смонтированный UNC — копируем напрямую.
    if (@is_readable($unc)) {
        return @copy($unc, $local);
    }

    $ps = serial_xlsx_powershell_exe();
    if ($ps === null) {
        return is_readable($local);
    }

    $tmpWin = 'C:\\Users\\Public\\nomera_korrektora_pull.xlsx';
    $tmpLinux = '/mnt/c/Users/Public/nomera_korrektora_pull.xlsx';
    $uncPs = str_replace("'", "''", $unc);
    $cmd =
        escapeshellarg($ps) .
        ' -NoProfile -Command ' .
        escapeshellarg(
            "Copy-Item -LiteralPath '" . $uncPs . "' -Destination '" . $tmpWin . "' -Force"
        ) .
        ' 2>/dev/null';
    exec($cmd, $out, $code);
    if ($code !== 0 || !is_readable($tmpLinux)) {
        return is_readable($local);
    }
    $ok = @copy($tmpLinux, $local);
    @unlink($tmpLinux);
    return $ok && is_readable($local);
}

/**
 * Залить локальную копию обратно на шару после выдачи номера.
 */
function serial_xlsx_push_to_unc(string $localPath): bool
{
    $unc = serial_xlsx_unc_path();
    if (@is_writable($unc) || (@file_exists($unc) === false && @is_writable(dirname($unc)))) {
        return (bool) @copy($localPath, $unc);
    }
    if (!is_readable($localPath)) {
        return false;
    }

    $ps = serial_xlsx_powershell_exe();
    if ($ps === null) {
        // Маркер для scripts/sync-serial-xlsx.sh --push
        @file_put_contents(dirname($localPath) . '/.need_push', (string) time());
        return false;
    }

    $tmpWin = 'C:\\Users\\Public\\nomera_korrektora_push.xlsx';
    $tmpLinux = '/mnt/c/Users/Public/nomera_korrektora_push.xlsx';
    if (!@copy($localPath, $tmpLinux)) {
        @file_put_contents(dirname($localPath) . '/.need_push', (string) time());
        return false;
    }
    $uncPs = str_replace("'", "''", $unc);
    $cmd =
        escapeshellarg($ps) .
        ' -NoProfile -Command ' .
        escapeshellarg(
            "Copy-Item -LiteralPath '" . $tmpWin . "' -Destination '" . $uncPs . "' -Force"
        ) .
        ' 2>/dev/null';
    exec($cmd, $out, $code);
    @unlink($tmpLinux);
    if ($code === 0) {
        @unlink(dirname($localPath) . '/.need_push');
        return true;
    }
    @file_put_contents(dirname($localPath) . '/.need_push', (string) time());
    return false;
}

function serial_xlsx_candidate_paths(): array
{
    $paths = [];
    $env = trim((string) (getenv('TM07_SERIAL_XLSX') ?: ''));
    if ($env !== '') {
        $paths[] = $env;
    }
    $unc = serial_xlsx_unc_path();
    if (@is_readable($unc)) {
        $paths[] = $unc;
    }
    $paths[] = serial_xlsx_local_path();
    $firmware = getenv('TM07_FIRMWARE_DIR') ?: '';
    if ($firmware !== '') {
        $paths[] = rtrim($firmware, '/\\') . '/Номера корректоров.xlsx';
    }
    $base = defined('BASE_PATH') ? BASE_PATH : dirname(__DIR__, 2);
    $paths[] = $base . '/firmware/Номера корректоров.xlsx';
    $paths[] = dirname($base) . '/firmware/Номера корректоров.xlsx';

    $out = [];
    foreach ($paths as $p) {
        if ($p !== '' && @is_readable($p)) {
            $real = realpath($p) ?: $p;
            if (!in_array($real, $out, true)) {
                $out[] = $real;
            }
        }
    }
    return $out;
}

function serial_xlsx_path(): ?string
{
    return serial_xlsx_seed_working_copy();
}

/**
 * Перед работой: подтянуть с шары в локальную копию (если UNC недоступен PHP напрямую).
 * Если шара доступна напрямую — работаем с ней.
 */
function serial_xlsx_seed_working_copy(): ?string
{
    $auto = getenv('TM07_SERIAL_AUTO_SYNC');
    if ($auto === false || $auto === '' || $auto === '1' || strtolower((string) $auto) === 'true') {
        serial_xlsx_pull_from_unc();
    }

    $work = serial_xlsx_working_path();
    if (@is_readable($work)) {
        return realpath($work) ?: $work;
    }

    $local = serial_xlsx_local_path();
    if (@is_readable($local)) {
        return realpath($local) ?: $local;
    }

    foreach (serial_xlsx_candidate_paths() as $src) {
        $dir = dirname($local);
        if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) {
            return $src;
        }
        if (@copy($src, $local)) {
            return realpath($local) ?: $local;
        }
        return $src;
    }
    return null;
}

function serial_xlsx_invalidate_cache(): void
{
    $GLOBALS['TM07_SERIAL_XLSX_INDEX'] = null;
}

function serial_xlsx_order_digits(string $raw): string
{
    $s = trim($raw);
    if ($s === '') {
        return '';
    }
    // Только заголовки колонок без номера: «Заказ на производство», «№».
    if (preg_match('/^(заказ(\s+на\s+производство)?|номер(\s+заказа)?|з\s*\/\s*п|№)$/iu', $s)) {
        return '';
    }
    $norm = str_replace(',', '.', $s);
    if (is_numeric($norm)) {
        $n = (int) round((float) $norm);
        return $n > 0 ? (string) $n : '';
    }
    if (!preg_match('/(\d+)\s*$/u', $s, $m)) {
        return '';
    }
    $d = ltrim($m[1], '0');
    return $d === '' ? '' : $d;
}

function serial_xlsx_parse_sn(string $raw): ?array
{
    $s = trim($raw);
    if (!preg_match('/^(300|400)(\d{2})(\d{2})(\d{3})$/', $s, $m)) {
        return null;
    }
    $mm = (int) $m[3];
    if ($mm < 1 || $mm > 12) {
        return null;
    }
    $prefix = $m[1];
    return [
        'serial' => $s,
        'kind' => $prefix === '400' ? 'complex' : 'corrector',
        'prefix' => $prefix,
        'yy' => (int) $m[2],
        'mm' => $mm,
        'seq' => (int) $m[4],
        'monthKey' => $m[2] . $m[3],
    ];
}

function serial_xlsx_load_index(): array
{
    $cached = $GLOBALS['TM07_SERIAL_XLSX_INDEX'] ?? null;
    $path = serial_xlsx_path();
    if ($path === null) {
        return [
            'ok' => false,
            'error' => 'Файл «Номера корректоров.xlsx» не найден',
            'path' => null,
            'mtime' => 0,
            'orders' => [],
            'maxSeq' => [],
        ];
    }
    $mtime = (int) filemtime($path);
    $size = (int) filesize($path);
    if (is_array($cached) && ($cached['path'] ?? '') === $path && (int) ($cached['mtime'] ?? 0) === $mtime && (int) ($cached['size'] ?? 0) === $size) {
        return $cached;
    }
    $parsed = serial_xlsx_parse_file($path);
    $parsed['ok'] = true;
    $parsed['path'] = $path;
    $parsed['mtime'] = $mtime;
    $parsed['size'] = $size;
    $GLOBALS['TM07_SERIAL_XLSX_INDEX'] = $parsed;
    return $parsed;
}

/**
 * @return array{orders: array<string, array{corrector:?string,complex:?string}>, maxSeq: array<string, array<string, int>>}
 */
function serial_xlsx_parse_file(string $path): array
{
    if (!class_exists(ZipArchive::class)) {
        throw new RuntimeException('ZipArchive недоступен — нельзя прочитать xlsx');
    }
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) {
        throw new RuntimeException('Не удалось открыть ' . $path);
    }
    try {
        $strings = serial_xlsx_shared_strings($zip);
        $sheets = serial_xlsx_sheet_map($zip);
        $orders = [];
        $maxSeq = ['300' => [], '400' => []];
        $meta = ['lastCorrectorRow' => 1, 'lastComplexRow' => 2];

        $corrXml = $sheets['Корректоры'] ?? $sheets['корректоры'] ?? null;
        if ($corrXml) {
            serial_xlsx_ingest_correctors($zip->getFromName($corrXml), $strings, $orders, $maxSeq, $meta);
        }
        $cxXml = $sheets['Комплексы'] ?? $sheets['комплексы'] ?? null;
        if ($cxXml) {
            serial_xlsx_ingest_complexes($zip->getFromName($cxXml), $strings, $orders, $maxSeq, $meta);
        }

        return [
            'orders' => $orders,
            'maxSeq' => $maxSeq,
            'lastCorrectorRow' => (int) $meta['lastCorrectorRow'],
            'lastComplexRow' => (int) $meta['lastComplexRow'],
            'sheets' => $sheets,
        ];
    } finally {
        $zip->close();
    }
}

function serial_xlsx_ns(): string
{
    return 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
}

function serial_xlsx_shared_strings(ZipArchive $zip): array
{
    $xml = $zip->getFromName('xl/sharedStrings.xml');
    if ($xml === false || $xml === '') {
        return [];
    }
    $root = @simplexml_load_string($xml);
    if ($root === false) {
        return [];
    }
    $ns = serial_xlsx_ns();
    $out = [];
    foreach ($root->children($ns)->si as $si) {
        $parts = [];
        foreach ($si->children($ns) as $child) {
            $name = $child->getName();
            if ($name === 't') {
                $parts[] = (string) $child;
            } elseif ($name === 'r') {
                foreach ($child->children($ns)->t as $t) {
                    $parts[] = (string) $t;
                }
            }
        }
        $out[] = implode('', $parts);
    }
    return $out;
}

function serial_xlsx_sheet_map(ZipArchive $zip): array
{
    $wb = @simplexml_load_string((string) $zip->getFromName('xl/workbook.xml'));
    $rels = @simplexml_load_string((string) $zip->getFromName('xl/_rels/workbook.xml.rels'));
    if ($wb === false || $rels === false) {
        return [];
    }
    $ns = serial_xlsx_ns();
    $nsR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    $pkgNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
    $ridToTarget = [];
    $relRoot = $rels->children($pkgNs);
    $relList = $relRoot->Relationship ?? $rels->Relationship;
    foreach ($relList as $rel) {
        $a = $rel->attributes();
        $id = trim((string) ($a['Id'] ?? ''));
        $target = trim((string) ($a['Target'] ?? ''));
        if ($id !== '' && $target !== '') {
            $ridToTarget[$id] = $target;
        }
    }
    $map = [];
    $sheetsNode = $wb->children($ns)->sheets;
    if (!$sheetsNode) {
        return [];
    }
    foreach ($sheetsNode->children($ns)->sheet as $sh) {
        $a = $sh->attributes();
        $name = trim((string) ($a['name'] ?? ''));
        $rid = trim((string) ($sh->attributes($nsR)['id'] ?? ''));
        $target = $ridToTarget[$rid] ?? '';
        if ($target === '') {
            continue;
        }
        if (!str_starts_with($target, 'xl/')) {
            $target = 'xl/' . ltrim($target, '/');
        }
        $map[$name] = $target;
    }
    return $map;
}

function serial_xlsx_sheet_rows(string $xml, array $strings): array
{
    $root = @simplexml_load_string($xml);
    if ($root === false) {
        return [];
    }
    $ns = serial_xlsx_ns();
    $rows = [];
    $sheetData = $root->children($ns)->sheetData;
    if ($sheetData === null) {
        return [];
    }
    foreach ($sheetData->children($ns)->row as $row) {
        foreach ($row->children($ns)->c as $c) {
            $ref = trim((string) ($c->attributes()['r'] ?? ''));
            if ($ref === '' || !preg_match('/^([A-Z]+)(\d+)$/', $ref, $m)) {
                continue;
            }
            $rows[(int) $m[2]][$m[1]] = serial_xlsx_cell_value($c, $strings);
        }
    }
    return $rows;
}

function serial_xlsx_cell_value(SimpleXMLElement $c, array $strings): string
{
    $type = trim((string) ($c->attributes()['t'] ?? ''));
    if ($type === 's') {
        $idx = (int) (string) $c->v;
        return (string) ($strings[$idx] ?? '');
    }
    if ($type === 'inlineStr') {
        $ns = serial_xlsx_ns();
        $parts = [];
        $is = $c->children($ns)->is;
        if ($is) {
            foreach ($is->children($ns) as $child) {
                if ($child->getName() === 't') {
                    $parts[] = (string) $child;
                } elseif ($child->getName() === 'r') {
                    foreach ($child->children($ns)->t as $t) {
                        $parts[] = (string) $t;
                    }
                }
            }
        }
        return implode('', $parts);
    }
    return trim((string) $c->v);
}

function serial_xlsx_remember_sn(array &$maxSeq, string $sn): void
{
    $p = serial_xlsx_parse_sn($sn);
    if (!$p) {
        return;
    }
    $cur = $maxSeq[$p['prefix']][$p['monthKey']] ?? 0;
    if ($p['seq'] > $cur) {
        $maxSeq[$p['prefix']][$p['monthKey']] = $p['seq'];
    }
}

function serial_xlsx_put_order(
    array &$orders,
    string $orderDigits,
    ?string $corrector,
    ?string $complex,
    ?int $correctorRow = null,
    ?int $complexRow = null
): void {
    if ($orderDigits === '') {
        return;
    }
    if (!isset($orders[$orderDigits])) {
        $orders[$orderDigits] = ['corrector' => null, 'complex' => null];
    }
    if ($corrector) {
        $orders[$orderDigits]['corrector'] = $corrector;
    }
    if ($complex) {
        $orders[$orderDigits]['complex'] = $complex;
    }
    if ($correctorRow) {
        $orders[$orderDigits]['correctorRow'] = $correctorRow;
    }
    if ($complexRow) {
        $orders[$orderDigits]['complexRow'] = $complexRow;
    }
}

function serial_xlsx_ingest_correctors(string $xml, array $strings, array &$orders, array &$maxSeq, array &$meta): void
{
    foreach (serial_xlsx_sheet_rows($xml, $strings) as $r => $cols) {
        $sns = [];
        foreach (['B', 'C', 'D', 'E'] as $col) {
            $p = serial_xlsx_parse_sn((string) ($cols[$col] ?? ''));
            if ($p && $p['kind'] === 'corrector') {
                $sns[] = $p['serial'];
                serial_xlsx_remember_sn($maxSeq, $p['serial']);
            }
        }
        $order = serial_xlsx_order_digits((string) ($cols['L'] ?? ''));
        if ($sns) {
            $meta['lastCorrectorRow'] = max((int) ($meta['lastCorrectorRow'] ?? 0), (int) $r);
        }
        foreach ($sns as $sn) {
            serial_xlsx_put_order($orders, $order, $sn, null, (int) $r, null);
        }
    }
}

function serial_xlsx_ingest_complexes(string $xml, array $strings, array &$orders, array &$maxSeq, array &$meta): void
{
    foreach (serial_xlsx_sheet_rows($xml, $strings) as $r => $cols) {
        $corr = serial_xlsx_parse_sn((string) ($cols['C'] ?? ''));
        $comp = serial_xlsx_parse_sn((string) ($cols['D'] ?? ''));
        if ($corr) {
            serial_xlsx_remember_sn($maxSeq, $corr['serial']);
        }
        if ($comp) {
            serial_xlsx_remember_sn($maxSeq, $comp['serial']);
        }
        if ($corr || $comp) {
            $meta['lastComplexRow'] = max((int) ($meta['lastComplexRow'] ?? 0), (int) $r);
        }
        $order = serial_xlsx_order_digits((string) ($cols['J'] ?? ''));
        serial_xlsx_put_order(
            $orders,
            $order,
            $corr && $corr['kind'] === 'corrector' ? $corr['serial'] : null,
            $comp && $comp['kind'] === 'complex' ? $comp['serial'] : null,
            null,
            ($corr || $comp) ? (int) $r : null
        );
    }
}

function serial_xlsx_lookup(string $orderNumber, string $kind): ?array
{
    $digits = serial_xlsx_order_digits($orderNumber);
    if ($digits === '') {
        return null;
    }
    $idx = serial_xlsx_load_index();
    $row = $idx['orders'][$digits] ?? null;
    if (!is_array($row)) {
        return null;
    }
    $sn = $kind === 'complex' ? ($row['complex'] ?? null) : ($row['corrector'] ?? null);
    if (!is_string($sn) || $sn === '') {
        return null;
    }
    $parsed = serial_xlsx_parse_sn($sn);
    if (!$parsed) {
        return null;
    }
    $parsed['orderDigits'] = $digits;
    $parsed['source'] = 'xlsx';
    $parsed['xlsxPath'] = $idx['path'] ?? null;
    return $parsed;
}

function serial_xlsx_max_seq(string $prefix, string $monthKey): int
{
    $idx = serial_xlsx_load_index();
    return (int) (($idx['maxSeq'][$prefix][$monthKey] ?? 0));
}

function serial_xlsx_xml(string $s): string
{
    return htmlspecialchars($s, ENT_XML1 | ENT_QUOTES, 'UTF-8');
}

function serial_xlsx_cell_num(string $ref, string $num, string $style = '93'): string
{
    return '<c r="' . $ref . '" s="' . $style . '"><v>' . serial_xlsx_xml($num) . '</v></c>';
}

function serial_xlsx_cell_str(string $ref, string $text, string $style = '93'): string
{
    if ($text === '') {
        return '<c r="' . $ref . '" s="' . $style . '"/>';
    }
    return '<c r="' . $ref . '" s="' . $style . '" t="inlineStr"><is><t>' . serial_xlsx_xml($text) . '</t></is></c>';
}

function serial_xlsx_upsert_row(string &$xml, int $r, string $rowXml): void
{
    $re = '/<row r="' . $r . '"[^>]*>.*?<\/row>/s';
    if (preg_match($re, $xml)) {
        $xml = preg_replace($re, $rowXml, $xml, 1) ?? $xml;
        return;
    }
    if (str_contains($xml, '</sheetData>')) {
        $xml = str_replace('</sheetData>', $rowXml . '</sheetData>', $xml);
        return;
    }
    throw new RuntimeException('В xlsx нет sheetData');
}

function serial_xlsx_bump_dimension(string &$xml, string $col, int $row): void
{
    $xml = preg_replace_callback(
        '/<dimension ref="A1:([A-Z]+)(\d+)"\/>/',
        static function (array $m) use ($col, $row) {
            $oldCol = $m[1];
            $oldRow = (int) $m[2];
            $newRow = max($oldRow, $row);
            $newCol = strlen($col) >= strlen($oldCol) && strcmp($col, $oldCol) > 0 ? $col : $oldCol;
            return '<dimension ref="A1:' . $newCol . $newRow . '"/>';
        },
        $xml,
        1
    ) ?? $xml;
}

function serial_xlsx_exec_col(string $execution): string
{
    $map = ['И1' => 'B', 'И2' => 'C', 'И3' => 'D', 'И4' => 'E'];
    $key = preg_match('/И\s*([1-4])/u', $execution, $m) ? ('И' . $m[1]) : 'И1';
    return $map[$key] ?? 'B';
}

/**
 * Следующий номер = последний в таблице за месяц + 1, строка пишется в xlsx.
 *
 * @return array{serial:string,prefix:string,kind:string,yy:int,mm:int,seq:int,monthKey:string,source:string}
 */
function serial_xlsx_issue_new(string $kind, string $orderNumber, string $monthKey, array $meta = []): array
{
    $prefix = $kind === 'complex' ? '400' : '300';
    $path = serial_xlsx_seed_working_copy();
    if ($path === null) {
        throw new RuntimeException('Нет файла «Номера корректоров.xlsx»');
    }
    if (!is_writable($path)) {
        throw new RuntimeException('Таблица серийников недоступна для записи: ' . $path);
    }

    $lock = fopen($path . '.lock', 'c');
    if ($lock === false) {
        throw new RuntimeException('Не удалось взять lock таблицы серийников');
    }
    if (!flock($lock, LOCK_EX)) {
        fclose($lock);
        throw new RuntimeException('Не удалось заблокировать таблицу серийников');
    }
    try {
        serial_xlsx_invalidate_cache();
        $idx = serial_xlsx_load_index();
        $max = serial_xlsx_max_seq($prefix, $monthKey);
        $seq = $max + 1;
        if ($seq > 999) {
            throw new RuntimeException('Исчерпан лимит номеров в месяце для ' . $prefix);
        }
        $serial = sprintf('%s%s%03d', $prefix, $monthKey, $seq);
        $parsed = serial_xlsx_parse_sn($serial);
        if (!$parsed) {
            throw new RuntimeException('Не удалось собрать S/N ' . $serial);
        }

        $digits = serial_xlsx_order_digits($orderNumber);
        $corrSn = $kind === 'corrector' ? $serial : trim((string) ($meta['serialCorrector'] ?? ''));
        $cxSn = $kind === 'complex' ? $serial : trim((string) ($meta['serialComplex'] ?? ''));
        if ($kind === 'complex' && $corrSn === '') {
            $prev = serial_xlsx_lookup($orderNumber, 'corrector');
            $corrSn = $prev['serial'] ?? '';
        }

        serial_xlsx_write_issue($path, [
            'orderDigits' => $digits,
            'corrector' => $corrSn,
            'complex' => $cxSn,
            'execution' => (string) ($meta['execution'] ?? ''),
            'productTitle' => (string) ($meta['productTitle'] ?? ''),
            'characteristics' => (string) ($meta['characteristics'] ?? ''),
            'customer' => (string) ($meta['customer'] ?? ''),
            'fwVersion' => (string) ($meta['fwVersion'] ?? ''),
            'kind' => $kind,
        ], $idx);
        serial_xlsx_invalidate_cache();
        // Локальная копия → шара (если работали не напрямую с UNC).
        if ($path !== serial_xlsx_unc_path()) {
            serial_xlsx_push_to_unc($path);
        }
        $parsed['source'] = 'xlsx-new';
        $parsed['orderDigits'] = $digits;
        $parsed['xlsxPath'] = $path;
        return $parsed;
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function serial_xlsx_write_issue(string $path, array $row, array $idx): void
{
    $zip = new ZipArchive();
    if ($zip->open($path) !== true) {
        throw new RuntimeException('Не удалось открыть xlsx для записи');
    }
    try {
        $sheets = serial_xlsx_sheet_map($zip);
        $digits = (string) ($row['orderDigits'] ?? '');
        $exec = (string) ($row['execution'] ?? '');
        $kind = (string) ($row['kind'] ?? '');

        $corrPath = $sheets['Корректоры'] ?? $sheets['корректоры'] ?? null;
        if ($corrPath && ($kind === 'corrector' || ($row['corrector'] ?? '') !== '')) {
            $xml = (string) $zip->getFromName($corrPath);
            $r = (int) ($idx['orders'][$digits]['correctorRow'] ?? 0);
            if ($r < 2) {
                $r = (int) ($idx['lastCorrectorRow'] ?? 1) + 1;
            }
            $col = serial_xlsx_exec_col($exec);
            $byCol = [
                'A' => serial_xlsx_cell_str('A' . $r, '', '5'),
                'B' => serial_xlsx_cell_str('B' . $r, '', '5'),
                'C' => serial_xlsx_cell_str('C' . $r, '', '5'),
                'D' => serial_xlsx_cell_str('D' . $r, '', '5'),
                'E' => serial_xlsx_cell_str('E' . $r, '', '5'),
            ];
            $sn = (string) ($row['corrector'] ?? '');
            if ($sn !== '') {
                $byCol[$col] = serial_xlsx_cell_num($col . $r, $sn, '5');
            }
            $rowXml = '<row r="' . $r . '" spans="1:12" x14ac:dyDescent="0.25">'
                . implode('', $byCol)
                . serial_xlsx_cell_str('F' . $r, (string) ($row['characteristics'] ?? ''), '5')
                . serial_xlsx_cell_str('G' . $r, '', '137')
                . serial_xlsx_cell_str('H' . $r, (string) ($row['customer'] ?? ''), '134')
                . serial_xlsx_cell_str('I' . $r, (string) ($row['fwVersion'] ?? ''), '157')
                . serial_xlsx_cell_str('J' . $r, '', '5')
                . serial_xlsx_cell_str('K' . $r, '', '5')
                . ($digits !== '' ? serial_xlsx_cell_num('L' . $r, $digits, '5') : serial_xlsx_cell_str('L' . $r, '', '5'))
                . '</row>';
            serial_xlsx_upsert_row($xml, $r, $rowXml);
            serial_xlsx_bump_dimension($xml, 'L', $r);
            $zip->deleteName($corrPath);
            $zip->addFromString($corrPath, $xml);
        }

        $cxPath = $sheets['Комплексы'] ?? $sheets['комплексы'] ?? null;
        if ($cxPath) {
            $xml = (string) $zip->getFromName($cxPath);
            $r = (int) ($idx['orders'][$digits]['complexRow'] ?? 0);
            if ($r < 2) {
                $r = (int) ($idx['lastComplexRow'] ?? 2) + 1;
            }
            $rowXml = '<row r="' . $r . '" spans="1:17" ht="31.5" x14ac:dyDescent="0.25">'
                . serial_xlsx_cell_str('A' . $r, '', '5')
                . serial_xlsx_cell_str('B' . $r, $exec, '5')
                . ((($row['corrector'] ?? '') !== '')
                    ? serial_xlsx_cell_num('C' . $r, (string) $row['corrector'], '93')
                    : serial_xlsx_cell_str('C' . $r, '', '93'))
                . ((($row['complex'] ?? '') !== '')
                    ? serial_xlsx_cell_num('D' . $r, (string) $row['complex'], '93')
                    : serial_xlsx_cell_str('D' . $r, '', '93'))
                . serial_xlsx_cell_str('E' . $r, (string) ($row['productTitle'] ?? ''), '93')
                . serial_xlsx_cell_str('F' . $r, (string) ($row['characteristics'] ?? ''), '93')
                . serial_xlsx_cell_str('G' . $r, (string) ($row['fwVersion'] ?? ''), '93')
                . serial_xlsx_cell_str('H' . $r, '', '91')
                . serial_xlsx_cell_str('I' . $r, (string) ($row['customer'] ?? ''), '93')
                . ($digits !== '' ? serial_xlsx_cell_num('J' . $r, $digits, '93') : serial_xlsx_cell_str('J' . $r, '', '93'))
                . '</row>';
            serial_xlsx_upsert_row($xml, $r, $rowXml);
            serial_xlsx_bump_dimension($xml, 'Q', $r);
            $zip->deleteName($cxPath);
            $zip->addFromString($cxPath, $xml);
        }
    } finally {
        $zip->close();
    }
}
