<?php
declare(strict_types=1);

// Simple counters API – list and retrieve counter parameters.
// Если задан TM07_COUNTERS_SHEET_URL (ссылка на Google Таблицу в .env / docker), список и параметры
// строки берутся из экспорта CSV (таблица должна быть доступна по ссылке «Просмотр» для всех).

require_once __DIR__ . '/auth_common.php';

header('Content-Type: application/json; charset=utf-8');

function counters_repo_root(): string
{
    return dirname(__DIR__, 2);
}

/**
 * Подставляет TM07_COUNTERS_SHEET_URL из корневого .env, если в окружении пусто.
 */
function counters_bootstrap_sheet_url_from_dotenv(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    $cur = getenv('TM07_COUNTERS_SHEET_URL');
    if (is_string($cur) && trim($cur) !== '') {
        return;
    }
    $path = counters_repo_root() . '/.env';
    if (!is_readable($path)) {
        return;
    }
    $raw = file_get_contents($path);
    if ($raw === false || $raw === '') {
        return;
    }
    foreach (preg_split('/\r\n|\r|\n/', $raw) as $line) {
        $line = trim((string) $line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        if (!str_contains($line, '=')) {
            continue;
        }
        if (preg_match('/^export\s+/i', $line)) {
            $line = preg_replace('/^export\s+/i', '', $line);
        }
        [$k, $v] = explode('=', $line, 2);
        $key = trim((string) $k);
        if ($key !== 'TM07_COUNTERS_SHEET_URL') {
            continue;
        }
        $value = trim((string) $v, " \t");
        $len = strlen($value);
        if (
            $len >= 2
            && (($value[0] === '"' && $value[$len - 1] === '"')
                || ($value[0] === "'" && $value[$len - 1] === "'"))
        ) {
            $value = substr($value, 1, -1);
        }
        if (trim($value) === '') {
            continue;
        }
        putenv('TM07_COUNTERS_SHEET_URL=' . $value);
        $_ENV['TM07_COUNTERS_SHEET_URL'] = $value;
        return;
    }
}

counters_bootstrap_sheet_url_from_dotenv();

function counters_sheet_url_effective(): ?string
{
    $u = getenv('TM07_COUNTERS_SHEET_URL');
    if (!is_string($u)) {
        return null;
    }
    $u = trim($u);
    return $u === '' ? null : $u;
}

function counters_google_sheet_id_and_gid(string $url): array
{
    $id = null;
    if (preg_match('#/spreadsheets/d/([a-zA-Z0-9_-]+)#', $url, $m)) {
        $id = $m[1];
    }
    $gid = '0';
    if (preg_match('/[#&?]gid=(\d+)/', $url, $m)) {
        $gid = $m[1];
    }
    return [$id, $gid];
}

function counters_sheet_csv_export_url(string $spreadsheetId, string $gid): string
{
    return 'https://docs.google.com/spreadsheets/d/' . rawurlencode($spreadsheetId)
        . '/export?format=csv&gid=' . rawurlencode($gid);
}

function counters_http_get(string $url, int $timeoutSec = 20): string
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        if ($ch === false) {
            throw new RuntimeException('curl_init failed');
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => $timeoutSec,
            CURLOPT_TIMEOUT => $timeoutSec,
            CURLOPT_USERAGENT => 'bench-counters/1',
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        if ($body === false || $code >= 400) {
            throw new RuntimeException('HTTP ' . $code . ($err !== '' ? ': ' . $err : ''));
        }
        return (string) $body;
    }
    $ctx = stream_context_create([
        'http' => [
            'timeout' => $timeoutSec,
            'header' => "User-Agent: bench-counters/1\r\n",
            'follow_location' => 1,
        ],
    ]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) {
        throw new RuntimeException('Не удалось скачать CSV таблицы');
    }
    return (string) $body;
}

/**
 * @return list<list<string>>
 */
function counters_parse_csv_rows(string $csv): array
{
    $csv = preg_replace("/^\xEF\xBB\xBF/", '', $csv) ?? $csv;
    $lines = preg_split('/\r\n|\r|\n/', $csv) ?: [];
    $rows = [];
    foreach ($lines as $line) {
        if ($line === '') {
            continue;
        }
        $rows[] = str_getcsv($line);
    }
    return $rows;
}

/**
 * @param list<string> $headers
 * @return array{nameIdx:int, serialIdx:?int, stepColIdx: array<int,int>}
 */
function counters_sheet_column_map(array $headers): array
{
    $norm = [];
    foreach ($headers as $i => $h) {
        $norm[$i] = mb_strtolower(trim((string) $h), 'UTF-8');
    }
    $nameSyn = ['name', 'название', 'имя', 'счётчик', 'счетчик', 'counter', 'тип', 'модель'];
    $serialSyn = ['serial', 'серийный', 'заводской', 'sn', 'сер. №', 'сер.номер', 'номер'];
    $nameIdx = 0;
    foreach ($norm as $i => $h) {
        if ($h === '') {
            continue;
        }
        foreach ($nameSyn as $s) {
            if ($h === $s || str_contains($h, $s)) {
                $nameIdx = $i;
                break 2;
            }
        }
    }
    $serialIdx = null;
    foreach ($norm as $i => $h) {
        if ($i === $nameIdx) {
            continue;
        }
        foreach ($serialSyn as $s) {
            if ($h === $s || str_contains($h, $s)) {
                $serialIdx = $i;
                break 2;
            }
        }
    }
    $stepColIdx = [];
    foreach ($norm as $i => $h) {
        if ($i === $nameIdx || $i === $serialIdx) {
            continue;
        }
        if (preg_match('/^(?:val_?|шаг_?)?(\d+)$/u', $h, $m)) {
            $sid = (int) $m[1];
            if ($sid >= 1 && $sid <= 79) {
                $stepColIdx[$sid] = $i;
            }
        } elseif (preg_match('/^(\d+)$/', $h, $m)) {
            $sid = (int) $m[1];
            if ($sid >= 1 && $sid <= 79) {
                $stepColIdx[$sid] = $i;
            }
        }
    }
    if ($serialIdx === null && isset($norm[1]) && $nameIdx === 0) {
        $h1 = $norm[1];
        if ($h1 !== '' && !preg_match('/^(?:val_?)?\d+$/', $h1) && !preg_match('/^\d+$/', $h1)) {
            $serialIdx = 1;
        }
    }
    return ['nameIdx' => $nameIdx, 'serialIdx' => $serialIdx, 'stepColIdx' => $stepColIdx];
}

/**
 * @return array{headers: list<string>, rows: list<array{id:int, name:string, serial:?string, cells:list<string>}>}
 */
function counters_sheet_fetch_bundle(): array
{
    $url = counters_sheet_url_effective();
    if ($url === null) {
        return ['headers' => [], 'rows' => []];
    }
    [$sid, $gid] = counters_google_sheet_id_and_gid($url);
    if ($sid === null) {
        throw new InvalidArgumentException('В TM07_COUNTERS_SHEET_URL не найден id таблицы (…/spreadsheets/d/ID/…)');
    }
    $csvUrl = counters_sheet_csv_export_url($sid, $gid);
    $csv = counters_http_get($csvUrl);
    $table = counters_parse_csv_rows($csv);
    if ($table === []) {
        return ['headers' => [], 'rows' => []];
    }
    $headers = array_map(static fn ($c) => (string) $c, $table[0]);
    $map = counters_sheet_column_map($headers);
    $out = [];
    $rid = 0;
    for ($r = 1, $n = count($table); $r < $n; $r++) {
        $cells = $table[$r];
        $name = trim((string) ($cells[$map['nameIdx']] ?? ''));
        if ($name === '') {
            continue;
        }
        $rid++;
        $serial = null;
        if ($map['serialIdx'] !== null) {
            $s = trim((string) ($cells[$map['serialIdx']] ?? ''));
            $serial = $s === '' ? null : $s;
        }
        $out[] = ['id' => $rid, 'name' => $name, 'serial' => $serial, 'cells' => array_map('strval', $cells)];
    }
    return ['headers' => $headers, 'rows' => $out];
}

/**
 * @param array{cells:list<string>, name:string, serial:?string} $entry
 * @return array<string, string>
 */
function counters_sheet_row_parameters(array $entry, array $stepColIdx): array
{
    $cells = $entry['cells'];
    $params = [];
    foreach ($stepColIdx as $stepId => $colIdx) {
        $v = trim((string) ($cells[$colIdx] ?? ''));
        if ($v === '') {
            continue;
        }
        $params[(string) $stepId] = $v;
    }
    return $params;
}

function counters_is_sheet_mode(): bool
{
    return counters_sheet_url_effective() !== null;
}

function counters_db_path(): string
{
    // Store counters DB in the user data directory (same as other APIs).
    return auth_data_dir() . '/counters.sqlite';
}

function counters_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $pdo = new PDO('sqlite:' . counters_db_path());
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS counters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            serial TEXT,
            parameters TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )'
    );
    return $pdo;
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    if ($action === 'list' && $method === 'GET') {
        if (counters_is_sheet_mode()) {
            try {
                $bundle = counters_sheet_fetch_bundle();
                $list = array_map(static function (array $e) {
                    return ['id' => $e['id'], 'name' => $e['name'], 'serial' => $e['serial']];
                }, $bundle['rows']);
                echo json_encode(['success' => true, 'counters' => $list, 'source' => 'sheet'], JSON_UNESCAPED_UNICODE);
            } catch (Throwable $e) {
                http_response_code(502);
                echo json_encode([
                    'success' => false,
                    'error' => DEBUG ? $e->getMessage() : 'Не удалось загрузить список из Google Таблицы',
                ], JSON_UNESCAPED_UNICODE);
            }
            exit;
        }
        $pdo = counters_db();
        $st = $pdo->query('SELECT id, name, serial FROM counters ORDER BY name');
        $list = $st->fetchAll();
        echo json_encode(['success' => true, 'counters' => $list, 'source' => 'sqlite'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'get' && $method === 'GET') {
        $id = intval($_GET['id'] ?? 0);
        if ($id <= 0) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Invalid id'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if (counters_is_sheet_mode()) {
            try {
                $bundle = counters_sheet_fetch_bundle();
                $entry = null;
                foreach ($bundle['rows'] as $e) {
                    if ((int) $e['id'] === $id) {
                        $entry = $e;
                        break;
                    }
                }
                if ($entry === null) {
                    http_response_code(404);
                    echo json_encode(['success' => false, 'error' => 'Counter not found'], JSON_UNESCAPED_UNICODE);
                    exit;
                }
                $headers = $bundle['headers'];
                $map = counters_sheet_column_map($headers);
                $params = counters_sheet_row_parameters($entry, $map['stepColIdx']);
                $row = [
                    'id' => $id,
                    'name' => $entry['name'],
                    'serial' => $entry['serial'],
                    'parameters' => $params,
                    'created_at' => '',
                    'updated_at' => '',
                ];
                echo json_encode(['success' => true, 'counter' => $row, 'source' => 'sheet'], JSON_UNESCAPED_UNICODE);
            } catch (Throwable $e) {
                http_response_code(502);
                echo json_encode([
                    'success' => false,
                    'error' => DEBUG ? $e->getMessage() : 'Не удалось прочитать строку из Google Таблицы',
                ], JSON_UNESCAPED_UNICODE);
            }
            exit;
        }
        $pdo = counters_db();
        $st = $pdo->prepare('SELECT * FROM counters WHERE id = :id');
        $st->execute([':id' => $id]);
        $row = $st->fetch();
        if (!$row) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Counter not found'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $params = json_decode($row['parameters'], true);
        $row['parameters'] = is_array($params) ? $params : [];
        echo json_encode(['success' => true, 'counter' => $row, 'source' => 'sqlite'], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'save' && $method === 'POST') {
        $raw = file_get_contents('php://input');
        $incoming = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($incoming) || !isset($incoming['name'])) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Invalid payload'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        auth_require_admin();
        $name = trim((string)$incoming['name']);
        $serial = isset($incoming['serial']) ? trim((string)$incoming['serial']) : null;
        $parameters = isset($incoming['parameters']) && is_array($incoming['parameters']) ? $incoming['parameters'] : [];
        $paramJson = json_encode($parameters, JSON_UNESCAPED_UNICODE);
        $now = gmdate('c');
        $pdo = counters_db();
        if (!empty($incoming['id'])) {
            // Update existing
            $id = intval($incoming['id']);
            $st = $pdo->prepare('UPDATE counters SET name = :name, serial = :serial, parameters = :params, updated_at = :upd WHERE id = :id');
            $st->execute([
                ':name' => $name,
                ':serial' => $serial,
                ':params' => $paramJson,
                ':upd' => $now,
                ':id' => $id,
            ]);
            $savedId = $id;
        } else {
            // Insert new
            $st = $pdo->prepare('INSERT INTO counters (name, serial, parameters, created_at, updated_at) VALUES (:name, :serial, :params, :crt, :upd)');
            $st->execute([
                ':name' => $name,
                ':serial' => $serial,
                ':params' => $paramJson,
                ':crt' => $now,
                ':upd' => $now,
            ]);
            $savedId = (int)$pdo->lastInsertId();
        }
        echo json_encode(['success' => true, 'id' => $savedId], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'delete' && $method === 'POST') {
        $id = intval($_GET['id'] ?? 0);
        if ($id <= 0) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Invalid id'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        auth_require_admin();
        $pdo = counters_db();
        $st = $pdo->prepare('DELETE FROM counters WHERE id = :id');
        $st->execute([':id' => $id]);
        echo json_encode(['success' => true], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // For now we only expose read‑only actions. Extend with POST/PUT as needed.
    if ($action === 'import-docx' && $method === 'POST') {
        auth_require_admin();
        $docxPath = counters_repo_root() . '/Параметризация (1).docx';
        if (!is_readable($docxPath)) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'DOCX не найден'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        $autoload = counters_repo_root() . '/vendor/autoload.php';
        if (!is_readable($autoload)) {
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => 'PHPWord не установлен (composer install)'], JSON_UNESCAPED_UNICODE);
            exit;
        }
        require_once $autoload;
        try {
            $phpWord = \PhpOffice\PhpWord\IOFactory::load($docxPath);
            $pdo = counters_db();
            $pdo->exec('BEGIN TRANSACTION');
            foreach ($phpWord->getSections() as $section) {
                foreach ($section->getElements() as $element) {
                    if ($element instanceof \PhpOffice\PhpWord\Element\Table) {
                        foreach ($element->getRows() as $row) {
                            $cells = $row->cells;
                            if (count($cells) < 4) continue;
                            $name = trim((string) $cells[0]->getText());
                            $dn = trim((string) $cells[1]->getText());
                            $qMin = trim((string) $cells[2]->getText());
                            $qMax = trim((string) $cells[3]->getText());
                            if (!$name) continue;
                            $params = [];
                            if ($dn) $params['78'] = preg_replace('/[^0-9]/', '', $dn);
                            if ($qMin) $params['28'] = str_replace(',', '.', $qMin);
                            if ($qMax) $params['29'] = str_replace(',', '.', $qMax);
                            $existing = $pdo->prepare('SELECT id FROM counters WHERE name = :name');
                            $existing->execute([':name' => $name]);
                            if ($existing->fetch()) continue;
                            $stmt = $pdo->prepare('INSERT INTO counters (name, parameters, created_at, updated_at) VALUES (:name, :params, :now, :now)');
                            $stmt->execute([
                                ':name' => $name,
                                ':params' => json_encode($params, JSON_UNESCAPED_UNICODE),
                                ':now' => gmdate('c')
                            ]);
                        }
                    }
                }
            }
            $pdo->exec('COMMIT');
            echo json_encode(['success' => true, 'imported' => true], JSON_UNESCAPED_UNICODE);
        } catch (Throwable $e) {
            $pdo->exec('ROLLBACK');
            http_response_code(500);
            echo json_encode(['success' => false, 'error' => DEBUG ? $e->getMessage() : 'Ошибка импорта DOCX'], JSON_UNESCAPED_UNICODE);
        }
        exit;
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Invalid request'], JSON_UNESCAPED_UNICODE);
    exit;
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => DEBUG ? $e->getMessage() : 'Ошибка сервера'], JSON_UNESCAPED_UNICODE);
    exit;
}
