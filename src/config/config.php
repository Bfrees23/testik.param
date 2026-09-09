<?php
/**
 * Конфигурация приложения.
 */
require_once __DIR__ . '/environment.php';

define('DEBUG', false);

define('DEFAULT_TIMEOUT', 2000);
define('MAX_SENDING_ATTEMPTS', 2);

define('BASE_PATH', dirname(__DIR__));
define('LOGS_PATH', BASE_PATH . '/logs');

if (!is_dir(LOGS_PATH)) {
    mkdir(LOGS_PATH, 0755, true);
}

require_once dirname(__DIR__) . '/api/lib/site_file_log.php';

date_default_timezone_set('Europe/Moscow');
mb_internal_encoding('UTF-8');
