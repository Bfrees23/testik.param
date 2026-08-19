<?php
declare(strict_types=1);

require_once __DIR__ . '/auth_common.php';

header('Content-Type: application/json; charset=utf-8');

function progress_db_path(): string
{
    return auth_data_dir() . '/bench_cycle_progress.sqlite';
}

function progress_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $pdo = new PDO('sqlite:' . progress_db_path());
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS cycle_progress (
            serial_number TEXT PRIMARY KEY,
            phase_states TEXT NOT NULL,
            next_phase_index INTEGER NOT NULL DEFAULT 0,
            last_phase TEXT NULL,
            cycle_status TEXT NULL,
            report_summary TEXT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )'
    );

    return $pdo;
}

function progress_normalize_serial(?string $raw): string
{
    $v = strtoupper(trim((string) $raw));
    $v = preg_replace('/\s+/u', '', $v) ?? '';
    if (!preg_match('/^[A-Z0-9._-]{3,40}$/', $v)) {
        return '';
    }
    return $v;
}

function progress_validate_phase_states($phaseStates): array
{
    if (!is_array($phaseStates)) {
        return [];
    }
    $out = [];
    foreach ($phaseStates as $k => $v) {
        if (!is_string($k) || !is_string($v)) {
            continue;
        }
        if (!preg_match('/^[a-z_]+$/', $k)) {
            continue;
        }
        if (!in_array($v, ['pending', 'running', 'done', 'failed', 'stopped'], true)) {
            continue;
        }
        $out[$k] = $v;
    }
    return $out;
}

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    require_once __DIR__ . '/bench_context.php';
    try {
        bench_require_operator_session();
    } catch (RuntimeException $e) {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
        exit;
    }

    if ($action === 'get' && $method === 'GET') {
        $serial = progress_normalize_serial($_GET['serial'] ?? '');
        if ($serial === '') {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Некорректный серийный номер'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $pdo = progress_db();
        $st = $pdo->prepare('SELECT * FROM cycle_progress WHERE serial_number = :serial');
        $st->execute([':serial' => $serial]);
        $row = $st->fetch();
        if (!$row) {
            echo json_encode(['success' => true, 'found' => false, 'serial' => $serial], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $phaseStates = json_decode((string) ($row['phase_states'] ?? '{}'), true);
        if (!is_array($phaseStates)) {
            $phaseStates = [];
        }

        echo json_encode(
            [
                'success' => true,
                'found' => true,
                'serial' => $serial,
                'progress' => [
                    'phaseStates' => $phaseStates,
                    'nextPhaseIndex' => (int) ($row['next_phase_index'] ?? 0),
                    'lastPhase' => $row['last_phase'] ?? null,
                    'cycleStatus' => $row['cycle_status'] ?? null,
                    'reportSummary' => $row['report_summary'] ?? null,
                    'createdAt' => $row['created_at'] ?? null,
                    'updatedAt' => $row['updated_at'] ?? null,
                ],
            ],
            JSON_UNESCAPED_UNICODE
        );
        exit;
    }

    if ($action === 'save' && $method === 'POST') {
        $raw = file_get_contents('php://input');
        $payload = is_string($raw) ? json_decode($raw, true) : null;
        if (!is_array($payload)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Ожидается JSON'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $serial = progress_normalize_serial($payload['serial'] ?? '');
        if ($serial === '') {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Некорректный серийный номер'], JSON_UNESCAPED_UNICODE);
            exit;
        }

        $phaseStates = progress_validate_phase_states($payload['phaseStates'] ?? []);
        $nextPhaseIndex = (int) ($payload['nextPhaseIndex'] ?? 0);
        if ($nextPhaseIndex < 0) {
            $nextPhaseIndex = 0;
        }
        if ($nextPhaseIndex > 7) {
            $nextPhaseIndex = 7;
        }

        $lastPhase = isset($payload['lastPhase']) ? trim((string) $payload['lastPhase']) : null;
        if ($lastPhase === '') {
            $lastPhase = null;
        }
        $cycleStatus = isset($payload['cycleStatus']) ? trim((string) $payload['cycleStatus']) : null;
        if ($cycleStatus === '') {
            $cycleStatus = null;
        }
        $reportSummary = isset($payload['reportSummary']) ? trim((string) $payload['reportSummary']) : null;
        if ($reportSummary === '') {
            $reportSummary = null;
        }

        $now = gmdate('c');
        $pdo = progress_db();
        $st = $pdo->prepare(
            'INSERT INTO cycle_progress (
                serial_number, phase_states, next_phase_index, last_phase, cycle_status, report_summary, created_at, updated_at
            ) VALUES (
                :serial, :phase_states, :next_phase_index, :last_phase, :cycle_status, :report_summary, :created_at, :updated_at
            )
            ON CONFLICT(serial_number) DO UPDATE SET
                phase_states = excluded.phase_states,
                next_phase_index = excluded.next_phase_index,
                last_phase = excluded.last_phase,
                cycle_status = excluded.cycle_status,
                report_summary = excluded.report_summary,
                updated_at = excluded.updated_at'
        );
        $st->execute([
            ':serial' => $serial,
            ':phase_states' => json_encode($phaseStates, JSON_UNESCAPED_UNICODE),
            ':next_phase_index' => $nextPhaseIndex,
            ':last_phase' => $lastPhase,
            ':cycle_status' => $cycleStatus,
            ':report_summary' => $reportSummary,
            ':created_at' => $now,
            ':updated_at' => $now,
        ]);

        echo json_encode(
            [
                'success' => true,
                'serial' => $serial,
                'saved' => [
                    'nextPhaseIndex' => $nextPhaseIndex,
                    'lastPhase' => $lastPhase,
                    'cycleStatus' => $cycleStatus,
                    'updatedAt' => $now,
                ],
            ],
            JSON_UNESCAPED_UNICODE
        );
        exit;
    }

    http_response_code(400);
    echo json_encode(['success' => false, 'error' => 'Неверный запрос'], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => DEBUG ? $e->getMessage() : 'Ошибка сервера'], JSON_UNESCAPED_UNICODE);
}
