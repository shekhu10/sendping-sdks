<?php

declare(strict_types=1);

use SendPing\Transport\CurlTransport;

/**
 * Drives the retry/backoff loop in CurlTransport without real network I/O by
 * overriding perform() (returns scripted statuses) and sleepSeconds() (records
 * waits instead of sleeping).
 */
class ScriptedCurlTransport extends CurlTransport
{
    /** @var array<int, array{status: int, retryAfter?: ?string}> */
    private array $script;
    public int $calls = 0;
    /** @var float[] */
    public array $waits = [];

    /** @param array<int, array{status: int, retryAfter?: ?string}> $script */
    public function __construct(array $script, int $timeoutSeconds = 30, int $maxRetries = 2)
    {
        parent::__construct($timeoutSeconds, $maxRetries);
        $this->script = $script;
    }

    protected function perform(string $method, string $url, array $headers, ?string $body): array
    {
        $step = $this->script[$this->calls] ?? $this->script[count($this->script) - 1];
        $this->calls++;
        return ['status' => $step['status'], 'body' => '{}', 'retryAfter' => $step['retryAfter'] ?? null];
    }

    protected function sleepSeconds(float $seconds): void
    {
        $this->waits[] = $seconds;
    }
}

// ---- 429 exhausts retries: maxRetries=2 → 3 attempts, 2 waits, returns last ----
$t = new ScriptedCurlTransport([['status' => 429]], 30, 2);
$res = $t->request('POST', 'https://x/', [], null);
check_same('retry: 429 attempt count = maxRetries+1', 3, $t->calls);
check_same('retry: 429 wait count = maxRetries', 2, count($t->waits));
check_same('retry: returns final status after exhausting', 429, $res['status']);

// ---- retryable then success: stops as soon as a non-retryable status arrives ----
$t = new ScriptedCurlTransport([['status' => 503], ['status' => 200]], 30, 2);
$res = $t->request('GET', 'https://x/', [], null);
check_same('retry: 503→200 makes 2 attempts', 2, $t->calls);
check_same('retry: 503→200 waits once', 1, count($t->waits));
check_same('retry: 503→200 returns 200', 200, $res['status']);

// ---- non-retryable 5xx is NOT retried ----
$t = new ScriptedCurlTransport([['status' => 500]], 30, 2);
$res = $t->request('POST', 'https://x/', [], null);
check_same('retry: 500 not retried (single attempt)', 1, $t->calls);
check_same('retry: 500 no waits', 0, count($t->waits));

// ---- maxRetries=0 disables retrying even on 429 ----
$t = new ScriptedCurlTransport([['status' => 429]], 30, 0);
$res = $t->request('POST', 'https://x/', [], null);
check_same('retry: maxRetries=0 → single attempt', 1, $t->calls);
check_same('retry: maxRetries=0 → no waits', 0, count($t->waits));

// ---- exponential backoff when Retry-After absent: 0.5, 1.0 ----
$t = new ScriptedCurlTransport([['status' => 429]], 30, 2);
$t->request('POST', 'https://x/', [], null);
check_same('backoff: exponential attempt 0 = 0.5s', 0.5, $t->waits[0]);
check_same('backoff: exponential attempt 1 = 1.0s', 1.0, $t->waits[1]);

// ---- Retry-After numeric seconds is honored verbatim ----
$t = new ScriptedCurlTransport([['status' => 429, 'retryAfter' => '5'], ['status' => 200]], 30, 2);
$t->request('POST', 'https://x/', [], null);
check_same('backoff: Retry-After "5" → 5.0s', 5.0, $t->waits[0]);

// ---- Retry-After larger than the cap is clamped to 30s ----
$t = new ScriptedCurlTransport([['status' => 429, 'retryAfter' => '120'], ['status' => 200]], 30, 2);
$t->request('POST', 'https://x/', [], null);
check_same('backoff: Retry-After "120" capped at 30s', 30.0, $t->waits[0]);

// ---- Retry-After HTTP-date in the past → 0 (negative floored) ----
$t = new ScriptedCurlTransport([
    ['status' => 429, 'retryAfter' => 'Wed, 21 Oct 2015 07:28:00 GMT'],
    ['status' => 200],
], 30, 2);
$t->request('POST', 'https://x/', [], null);
check_same('backoff: past HTTP-date → 0s', 0.0, $t->waits[0]);

// ---- unparseable Retry-After falls back to exponential backoff ----
$t = new ScriptedCurlTransport([['status' => 429, 'retryAfter' => 'not-a-date'], ['status' => 200]], 30, 2);
$t->request('POST', 'https://x/', [], null);
check_same('backoff: unparseable Retry-After → exponential 0.5s', 0.5, $t->waits[0]);

// ---- client options thread timeout/maxRetries into the default transport ----
$mb = \SendPing\SendPing::client('mb_test_key', ['timeout' => 5, 'maxRetries' => 4]);
check('client: constructs with timeout/maxRetries options', $mb instanceof \SendPing\Client);
