<?php
declare(strict_types=1);

/**
 * Скачивание Windows-агента Senselock для идентификации рабочего места.
 * Только администратор.
 *
 * GET /api/senselock-agent-download.php           — ZIP (по умолчанию)
 * GET /api/senselock-agent-download.php?format=zip
 * GET /api/senselock-agent-download.php?format=cmd — один .cmd (установка в %%LOCALAPPDATA%%)
 */
require_once __DIR__ . '/auth_common.php';

auth_session_start();
auth_require_admin();

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function senselock_agent_dir(): string
{
    $candidates = [
        BASE_PATH . '/agents/senselock-workstation',
        dirname(BASE_PATH) . '/scripts/windows',
    ];
    foreach ($candidates as $d) {
        $real = realpath($d);
        if ($real && is_dir($real) && is_file($real . DIRECTORY_SEPARATOR . 'senselock-workstation-agent.ps1')) {
            return $real;
        }
    }
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(
        ['ok' => false, 'error' => 'Файлы агента не найдены (src/agents/senselock-workstation)'],
        JSON_UNESCAPED_UNICODE
    );
    exit;
}

function senselock_agent_read(string $dir, string $name): string
{
    $path = $dir . DIRECTORY_SEPARATOR . $name;
    if (!is_file($path)) {
        throw new RuntimeException('Нет файла: ' . $name);
    }
    $raw = file_get_contents($path);
    if ($raw === false) {
        throw new RuntimeException('Не удалось прочитать: ' . $name);
    }

    return $raw;
}

/**
 * Один .cmd: payload base64 внутри файла → %LOCALAPPDATA%\TM07\senselock-agent → запуск.
 */
function senselock_agent_build_cmd(string $dir): string
{
    $ps1 = senselock_agent_read($dir, 'senselock-workstation-agent.ps1');
    try {
        $readme = senselock_agent_read($dir, 'README.txt');
    } catch (Throwable) {
        $readme = "TM-07 Senselock agent\r\nhttp://127.0.0.1:18779\r\n";
    }

    $ps1B64 = chunk_split(base64_encode($ps1), 76, "\r\n");
    $rdB64 = chunk_split(base64_encode($readme), 76, "\r\n");

    // Отдельный bootstrap.ps1 кладём рядом при генерации… нет: всё в одном .cmd.
    // Читаем маркеры из самого .cmd через powershell -File с скриптом из -Command слишком длинный.
    // Решение: вынести bootstrap в agents и вшить его тоже как B64 короткого скрипта (~1–2 KB).
    $bootstrap = <<<'PS1'
param([Parameter(Mandatory=$true)][string]$PayloadPath)
$ErrorActionPreference = 'Stop'
$all = Get-Content -LiteralPath $PayloadPath
$i = 0
while ($i -lt $all.Count -and $all[$i] -ne ':::PS1_B64') { $i++ }
if ($i -ge $all.Count) { throw 'PS1 payload marker missing' }
$i++
$psParts = New-Object System.Collections.Generic.List[string]
while ($i -lt $all.Count -and $all[$i] -ne ':::README_B64') {
    $t = $all[$i].Trim()
    if ($t) { [void]$psParts.Add($t) }
    $i++
}
if ($i -ge $all.Count) { throw 'README marker missing' }
$i++
$rdParts = New-Object System.Collections.Generic.List[string]
while ($i -lt $all.Count -and $all[$i] -ne ':::END') {
    $t = $all[$i].Trim()
    if ($t) { [void]$rdParts.Add($t) }
    $i++
}
$dest = Join-Path $env:LOCALAPPDATA 'TM07\senselock-agent'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$ps1Path = Join-Path $dest 'senselock-workstation-agent.ps1'
$rdPath = Join-Path $dest 'README.txt'
[IO.File]::WriteAllBytes($ps1Path, [Convert]::FromBase64String(($psParts -join '')))
[IO.File]::WriteAllBytes($rdPath, [Convert]::FromBase64String(($rdParts -join '')))
# UTF-8 BOM so Windows PowerShell 5.1 parses non-ASCII (if any) correctly
$utf8Bom = New-Object System.Text.UTF8Encoding $true
$ps1Text = [IO.File]::ReadAllText($ps1Path, [Text.Encoding]::UTF8)
[IO.File]::WriteAllText($ps1Path, $ps1Text, $utf8Bom)
Unblock-File -LiteralPath $ps1Path -ErrorAction SilentlyContinue
Unblock-File -LiteralPath $rdPath -ErrorAction SilentlyContinue
$start = Join-Path $dest 'start-senselock-agent.cmd'
$startBody = @"
@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath '%~dp0senselock-workstation-agent.ps1' -ErrorAction SilentlyContinue; & '%~dp0senselock-workstation-agent.ps1' @args" %*
if errorlevel 1 pause
"@
[IO.File]::WriteAllText($start, $startBody.Replace("`n", "`r`n"), [Text.UTF8Encoding]::new($false))
Write-Host ""
Write-Host " Installed to: $dest"
Write-Host " Starting agent in THIS window (do not close)."
Write-Host " Browser check: http://127.0.0.1:18779/status"
Write-Host ""
# Same window — so bind/key errors are visible (Start-Process window was closing silently).
& $ps1Path
PS1;

    $bootB64 = chunk_split(base64_encode($bootstrap), 76, "\r\n");

    // Без findstr: PowerShell сам читает этот .cmd по $env:SELF (кириллица в имени ломала findstr).
    $extractBoot = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "'
        . '$ErrorActionPreference=\'Stop\'; '
        . '$all=Get-Content -LiteralPath $env:SELF; '
        . '$boot=@(); foreach($line in $all){ if($line.StartsWith(\':b:\')){ $boot+=$line.Substring(3).Trim() } }; '
        . 'if(-not $boot.Count){ throw \'bootstrap payload missing\' }; '
        . '[IO.File]::WriteAllBytes($env:BOOT,[Convert]::FromBase64String(($boot -join \'\')))'
        . '"';

    $cmd = "@echo off\r\n"
        . "chcp 65001 >nul\r\n"
        . "setlocal EnableExtensions\r\n"
        . "title TM-07 Senselock agent setup\r\n"
        . "echo.\r\n"
        . "echo  TM-07 Senselock - setup and start\r\n"
        . "echo  Insert Senselock Elite4 USB key.\r\n"
        . "echo.\r\n"
        . "set \"SELF=%~f0\"\r\n"
        . "set \"BOOT=%TEMP%\\tm07-senselock-bootstrap.ps1\"\r\n"
        . $extractBoot . "\r\n"
        . "if errorlevel 1 goto :fail\r\n"
        . "powershell -NoProfile -ExecutionPolicy Bypass -File \"%BOOT%\" \"%SELF%\"\r\n"
        . "if errorlevel 1 goto :fail\r\n"
        . "echo.\r\n"
        . "echo Agent stopped.\r\n"
        . "pause\r\n"
        . "exit /b 0\r\n"
        . ":fail\r\n"
        . "echo ERROR: agent setup failed.\r\n"
        . "pause\r\n"
        . "exit /b 1\r\n"
        . "\r\n";

    // Bootstrap lines prefixed with :b: so findstr can extract them (labels-like, ignored by cmd if after exit).
    foreach (preg_split("/\r\n|\n|\r/", trim($bootB64)) as $line) {
        $line = trim($line);
        if ($line === '') {
            continue;
        }
        $cmd .= ':b:' . $line . "\r\n";
    }

    $cmd .= "\r\n:::PS1_B64\r\n" . $ps1B64 . "\r\n:::README_B64\r\n" . $rdB64 . "\r\n:::END\r\n";

    return $cmd;
}

function senselock_agent_serve_cmd(string $dir): never
{
    $body = senselock_agent_build_cmd($dir);
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="TM07-Senselock-Agent.cmd"');
    header('Content-Length: ' . (string) strlen($body));
    echo $body;
    exit;
}

function senselock_agent_serve_zip(string $dir): never
{
    if (!class_exists('ZipArchive')) {
        senselock_agent_serve_cmd($dir);
    }

    $tmp = tempnam(sys_get_temp_dir(), 'tm07sl');
    if ($tmp === false) {
        throw new RuntimeException('tempnam failed');
    }
    $zipPath = $tmp . '.zip';
    @unlink($tmp);

    $zip = new ZipArchive();
    if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        throw new RuntimeException('ZipArchive open failed');
    }

    // Только ASCII-имена: кириллица (ЗАПУСТИТЬ.cmd) ломает cmd/findstr на многих системах.
    $launcher = senselock_agent_build_cmd($dir);
    $zip->addFromString('START.cmd', $launcher);
    $zip->addFromString('TM07-Senselock-Agent.cmd', $launcher);

    foreach (['senselock-workstation-agent.ps1', 'start-senselock-agent.cmd', 'README.txt'] as $name) {
        $path = $dir . DIRECTORY_SEPARATOR . $name;
        if (is_file($path)) {
            $zip->addFile($path, 'source\\' . $name);
        }
    }
    $zip->close();

    $size = filesize($zipPath);
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="TM07-Senselock-Agent.zip"');
    if ($size !== false) {
        header('Content-Length: ' . (string) $size);
    }
    readfile($zipPath);
    @unlink($zipPath);
    exit;
}

try {
    $dir = senselock_agent_dir();
    // По умолчанию — один .cmd (удобнее и надёжнее, чем ZIP из проводника).
    $format = strtolower(trim((string) ($_GET['format'] ?? 'cmd')));
    if ($format === 'zip') {
        senselock_agent_serve_zip($dir);
    }
    senselock_agent_serve_cmd($dir);
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    exit;
}
