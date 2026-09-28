<?php

declare(strict_types=1);

namespace SendPing\Transport;

use SendPing\Exceptions\SendPingException;

/**
 * Default HTTP transport backed by the curl extension (no composer runtime deps).
 *
 * Every request is bounded by a configurable timeout and automatically retried a
 * bounded number of times on eligible HTTP 429 and 503 responses. Partial work
 * stops retries; writes need a pre-processing rejection or a supported key.
 * No other status, network error, or
 * timeout is retried. Because both the JSON and raw/binary paths in {@see \SendPing\Client}
 * funnel through {@see request()}, both inherit the timeout and retry behavior.
 */
class CurlTransport implements TransportInterface
{
    /** Candidate statuses; retryAllowed also checks the response and operation. */
    private const RETRYABLE = [429, 503];

    /** Hard cap on any single backoff wait, in seconds. */
    private const MAX_BACKOFF_SECONDS = 30.0;

    /**
     * @param int $timeoutSeconds Per-request timeout in seconds; 0 disables the timeout.
     * @param int $maxRetries     Max automatic retries on 429/503 (0 disables; default 2 → up to 3 attempts).
     */
    public function __construct(
        private readonly int $timeoutSeconds = 30,
        private readonly int $maxRetries = 2,
    ) {
    }

    public function request(string $method, string $url, array $headers, ?string $body): array
    {
        $maxRetries = max(0, $this->maxRetries);
        for ($attempt = 0; ; $attempt++) {
            $response = $this->perform($method, $url, $headers, $body);

            if (!in_array($response['status'], self::RETRYABLE, true) || $attempt >= $maxRetries
                || !self::retryAllowed($method, $url, $headers, $response['status'], $response['body'])) {
                return ['status' => $response['status'], 'body' => $response['body']];
            }

            $this->sleepSeconds($this->backoffSeconds($response['retryAfter'], $attempt));
        }
    }

    private static function retryAllowed(string $method, string $url, array $headers, int $status, string $raw): bool
    {
        $body = json_decode($raw, true);
        $body = is_array($body) ? $body : [];
        if (!empty($body['id']) || (is_numeric($body['sent_count'] ?? null) && $body['sent_count'] > 0)
            || !empty($body['sent']) || !empty($body['reserved']) || ($body['name'] ?? null) === 'batch_incomplete') {
            return false;
        }
        if ($status !== 503 || in_array($method, ['GET', 'HEAD'], true)) return true;
        if (in_array($body['name'] ?? null, ['service_unavailable', 'sending_service_unavailable',
            'sending_configuration_unavailable', 'contacts_busy', 'contacts_timeout'], true)) return true;
        foreach ($headers as $header) {
            if (strncasecmp($header, 'Idempotency-Key:', 16) === 0 && trim(substr($header, 16)) !== '') {
                return $method === 'POST' && (bool) preg_match('~/emails(?:/batch|/receiving/[^/]+/(?:reply|forward))?$~', (string) parse_url($url, PHP_URL_PATH));
            }
        }
        return false;
    }

    /**
     * Execute a single HTTP request via curl, capturing the status, body, and the
     * Retry-After response header (null when absent). Response headers are read via
     * a header callback since curl otherwise returns only the body. Isolated behind
     * a protected method so the retry loop above can be exercised without real I/O.
     *
     * @param string[] $headers
     *
     * @return array{status: int, body: string, retryAfter: ?string}
     */
    protected function perform(string $method, string $url, array $headers, ?string $body): array
    {
        $ch = curl_init($url);
        if ($ch === false) {
            throw new SendPingException('SendPing: failed to initialize curl.', 0, 'network_error');
        }

        $retryAfter = null;
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => max(0, $this->timeoutSeconds),
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HEADERFUNCTION => static function ($ch, string $header) use (&$retryAfter): int {
                $colon = strpos($header, ':');
                if ($colon !== false && strcasecmp(substr($header, 0, $colon), 'Retry-After') === 0) {
                    $retryAfter = trim(substr($header, $colon + 1));
                }
                return strlen($header);
            },
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }

        $responseBody = curl_exec($ch);
        if ($responseBody === false) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new SendPingException('Network error: ' . $error, 0, 'network_error');
        }

        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        return ['status' => $status, 'body' => (string) $responseBody, 'retryAfter' => $retryAfter];
    }

    /**
     * Seconds to wait before the next retry. Honors a Retry-After header when it is
     * a number of seconds or an HTTP-date; otherwise falls back to exponential
     * backoff min(30, 0.5 * 2**attempt) where $attempt is 0 for the first retry.
     * Never negative, always capped at 30s.
     */
    protected function backoffSeconds(?string $retryAfter, int $attempt): float
    {
        $fromHeader = $this->parseRetryAfter($retryAfter);
        if ($fromHeader !== null) {
            return $fromHeader;
        }

        return min(self::MAX_BACKOFF_SECONDS, 0.5 * (2 ** $attempt));
    }

    /**
     * Parse a Retry-After header into a wait in seconds (floored at 0, capped at
     * 30), or null when absent/unparseable so the caller falls back to exponential
     * backoff.
     */
    private function parseRetryAfter(?string $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_numeric($value)) {
            $seconds = (float) $value;
        } else {
            $timestamp = strtotime($value);
            if ($timestamp === false) {
                return null;
            }
            $seconds = (float) ($timestamp - time());
        }

        if ($seconds < 0) {
            $seconds = 0.0;
        }

        return min(self::MAX_BACKOFF_SECONDS, $seconds);
    }

    /** Sleep for a fractional number of seconds. Overridable so tests can skip real waits. */
    protected function sleepSeconds(float $seconds): void
    {
        if ($seconds > 0) {
            usleep((int) round($seconds * 1_000_000));
        }
    }
}
