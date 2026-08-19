#!/usr/bin/env php
<?php
declare(strict_types=1);

/**
 * Extract label text, font sizes and positions from a BarTender .btw file.
 *
 * Usage:
 *   php btw-extract-label.php [/path/to/template.btw]
 *   docker compose exec php php /app/scripts/btw-extract-label.php /app/data/nameplate-templates/corrector-300.btw
 */

require_once dirname(__DIR__) . '/api/lib/btw_parser.php';

$path = $argv[1] ?? (btw_templates_dir() . '/corrector-300.btw');
if (!is_readable($path)) {
    fwrite(STDERR, "File not found or not readable: {$path}\n");
    exit(1);
}

try {
    $spec = btw_extract_label_spec_file($path);
    echo json_encode($spec, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
} catch (Throwable $e) {
    fwrite(STDERR, 'Error: ' . $e->getMessage() . "\n");
    exit(1);
}
