<?php

declare(strict_types=1);

/**
 * Plain-PHP test runner (no composer deps needed):
 *
 *     php tests/run.php
 *
 * Registers a PSR-4 autoloader for src/, loads the fake transport + assertion
 * helpers, then runs every tests/cases/*Test.php file. Exits non-zero on any
 * failure.
 */

spl_autoload_register(static function (string $class): void {
    $prefix = 'SendPing\\';
    if (str_starts_with($class, $prefix)) {
        $path = __DIR__ . '/../src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
        if (is_file($path)) {
            require $path;
        }
    }
});

require __DIR__ . '/helpers.php';
require __DIR__ . '/FakeTransport.php';

$caseFiles = glob(__DIR__ . '/cases/*Test.php') ?: [];
sort($caseFiles);
foreach ($caseFiles as $file) {
    echo "\n== " . basename($file) . " ==\n";
    require $file;
}

mb_test_summary();
