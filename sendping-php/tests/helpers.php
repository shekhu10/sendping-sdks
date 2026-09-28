<?php

declare(strict_types=1);

$GLOBALS['__mb_pass'] = 0;
$GLOBALS['__mb_fail'] = 0;

/** Assert a boolean condition. */
function check(string $name, bool $condition): void
{
    if ($condition) {
        $GLOBALS['__mb_pass']++;
        echo "ok   - {$name}\n";
    } else {
        $GLOBALS['__mb_fail']++;
        echo "FAIL - {$name}\n";
    }
}

/** Assert strict equality, printing both sides on failure. */
function check_same(string $name, mixed $expected, mixed $actual): void
{
    if ($expected === $actual) {
        $GLOBALS['__mb_pass']++;
        echo "ok   - {$name}\n";
    } else {
        $GLOBALS['__mb_fail']++;
        echo "FAIL - {$name}\n";
        echo '       expected: ' . var_export($expected, true) . "\n";
        echo '       actual:   ' . var_export($actual, true) . "\n";
    }
}

/**
 * Build a client wired to a FakeTransport.
 *
 * @return array{0: \SendPing\Client, 1: \SendPing\Tests\FakeTransport}
 */
function make_client(): array
{
    $transport = new \SendPing\Tests\FakeTransport();
    $client = \SendPing\SendPing::client('mb_test_key', ['transport' => $transport]);
    return [$client, $transport];
}

/** Assert the standard auth + JSON headers on a recorded request. */
function check_auth(string $name, array $request): void
{
    check($name . ': bearer auth header', in_array('Authorization: Bearer mb_test_key', $request['headers'], true));
}

/** Print the summary and exit with a status code. */
function mb_test_summary(): void
{
    $pass = $GLOBALS['__mb_pass'];
    $fail = $GLOBALS['__mb_fail'];
    echo "\n{$pass} passed, {$fail} failed\n";
    exit($fail === 0 ? 0 : 1);
}
