<?php
declare(strict_types=1);

/**
 * Формат S/N (300/400 + YYMM + seq) и разбор номера заказа.
 *
 * Чтение/запись «Номера корректоров.xlsx» ОТКЛЮЧЕНЫ.
 * Выдача серийников — только БД (TM07_SERIAL_COUNTER / TM07_SERIAL_ISSUED).
 */

function serial_xlsx_order_digits(string $raw): string
{
    $s = trim($raw);
    if ($s === '') {
        return '';
    }
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

/** @deprecated Excel отключён */
function serial_xlsx_lookup(string $orderNumber, string $kind): ?array
{
    return null;
}

/** @deprecated Excel отключён */
function serial_xlsx_max_seq(string $prefix, string $monthKey): int
{
    return 0;
}

/** @deprecated Excel отключён */
function serial_xlsx_next_seq(string $prefix, string $monthKey, int $floorSeq = 0): int
{
    $seq = max(0, $floorSeq) + 1;
    if ($seq > 999) {
        throw new RuntimeException('Порядковый номер серийника > 999 за месяц');
    }
    return $seq;
}

/** @deprecated Excel отключён */
function serial_xlsx_issue_new(string $kind, string $orderNumber, string $monthKey, array $meta = []): array
{
    throw new RuntimeException('Выдача через Excel отключена — используется только БД');
}

/** @deprecated Excel отключён */
function serial_xlsx_invalidate_cache(): void
{
}
