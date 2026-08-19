<?php
/**
 * API входа/выхода администратора.
 * Окружение: **prod** (project) / **dev** — переменная `APP_ENV` в compose.
 */
declare(strict_types=1);

require_once __DIR__ . '/auth_common.php';

header('Content-Type: application/json; charset=utf-8');

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    switch ($action) {
        case 'status':
            auth_session_start();
            $ok = !empty($_SESSION['admin']);
            echo json_encode([
                'success' => true,
                'loggedIn' => $ok,
                'loginAt' => $ok ? ($_SESSION['login_at'] ?? null) : null,
            ], JSON_UNESCAPED_UNICODE);
            break;

        case 'login':
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['success' => false, 'error' => 'POST only'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $rl = auth_rate_limit_check('admin_login', 8, 300);
            if (!$rl['ok']) {
                http_response_code(429);
                echo json_encode([
                    'success' => false,
                    'error' => 'Слишком много попыток входа. Повторите через ' . (int) ($rl['retryAfter'] ?? 300) . ' с.',
                    'retryAfter' => (int) ($rl['retryAfter'] ?? 300),
                ], JSON_UNESCAPED_UNICODE);
                break;
            }
            $raw = file_get_contents('php://input');
            $data = is_string($raw) ? json_decode($raw, true) : [];
            $password = isset($data['password']) ? (string) $data['password'] : '';
            if ($password === '') {
                http_response_code(400);
                echo json_encode(['success' => false, 'error' => 'Укажите пароль'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if (!auth_verify_password($password)) {
                auth_rate_limit_fail('admin_login', 8, 300);
                http_response_code(403);
                echo json_encode(['success' => false, 'error' => 'Неверный пароль'], JSON_UNESCAPED_UNICODE);
                break;
            }
            auth_rate_limit_clear('admin_login');
            auth_login();
            echo json_encode(['success' => true, 'message' => 'Вход выполнен'], JSON_UNESCAPED_UNICODE);
            break;

        case 'logout':
            auth_logout();
            echo json_encode(['success' => true, 'message' => 'Выход выполнен'], JSON_UNESCAPED_UNICODE);
            break;

        case 'changePassword':
            auth_require_admin();
            if ($method !== 'POST') {
                http_response_code(405);
                echo json_encode(['success' => false, 'error' => 'POST only'], JSON_UNESCAPED_UNICODE);
                break;
            }
            $raw = file_get_contents('php://input');
            $data = is_string($raw) ? json_decode($raw, true) : [];
            $current = isset($data['current']) ? (string) $data['current'] : '';
            $next = isset($data['next']) ? (string) $data['next'] : '';
            if ($next === '' || strlen($next) < 8) {
                http_response_code(400);
                echo json_encode(['success' => false, 'error' => 'Новый пароль не короче 8 символов'], JSON_UNESCAPED_UNICODE);
                break;
            }
            if (!auth_verify_password($current)) {
                http_response_code(403);
                echo json_encode(['success' => false, 'error' => 'Текущий пароль неверен'], JSON_UNESCAPED_UNICODE);
                break;
            }
            auth_set_password($next);
            echo json_encode(['success' => true, 'message' => 'Пароль обновлён'], JSON_UNESCAPED_UNICODE);
            break;

        default:
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Неизвестное действие'], JSON_UNESCAPED_UNICODE);
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => DEBUG ? $e->getMessage() : 'Ошибка сервера'], JSON_UNESCAPED_UNICODE);
}
