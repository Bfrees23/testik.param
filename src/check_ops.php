<?php
require __DIR__ . '/api/db_bench.php';
$db = bench_pdo();
$r = $db->query('SELECT LOGIN, LAST_NAME, FIRST_NAME, PIN_HASH FROM TM07_OPERATOR');
foreach ($r as $row) {
    echo $row['LOGIN'] . ' | ' . $row['LAST_NAME'] . ' ' . $row['FIRST_NAME'] . ' | PIN_HASH=' . $row['PIN_HASH'] . PHP_EOL;
}