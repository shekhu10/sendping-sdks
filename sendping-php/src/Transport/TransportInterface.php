<?php

declare(strict_types=1);

namespace SendPing\Transport;

/**
 * Minimal HTTP transport abstraction so the SDK's HTTP layer is swappable
 * (the tests substitute a fake transport; production uses curl).
 */
interface TransportInterface
{
    /**
     * Perform an HTTP request and return the raw response.
     *
     * @param string      $method  HTTP method, e.g. 'POST'.
     * @param string      $url     Absolute URL.
     * @param string[]    $headers Header lines, e.g. ['Authorization: Bearer …'].
     * @param string|null $body    Raw request body (already JSON-encoded), or null for none.
     *
     * @return array{status: int, body: string}
     *
     * @throws \SendPing\Exceptions\SendPingException on transport-level failure.
     */
    public function request(string $method, string $url, array $headers, ?string $body): array;
}
