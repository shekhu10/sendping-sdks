<?php

declare(strict_types=1);

namespace SendPing;

/**
 * Entry point for the SendPing PHP SDK.
 *
 * ```php
 * $sendping = SendPing\SendPing::client('mb_xxxxxxxxx');
 *
 * $sendping->emails->send([
 *     'from' => 'Acme <hello@yourdomain.com>',
 *     'to' => ['user@example.com'],
 *     'subject' => 'Hello',
 *     'html' => '<p>Hi 👋</p>',
 * ]);
 * ```
 */
final class SendPing
{
    public const VERSION = '1.0.0';

    /**
     * Create a SendPing API client.
     *
     * @param string $apiKey  Your API key, e.g. 'mb_xxxxxxxxx'.
     * @param array  $options Optional config:
     *                        - 'baseUrl'   (string) override the API host
     *                        - 'transport' (Transport\TransportInterface) swap the HTTP transport (e.g. for tests)
     */
    public static function client(string $apiKey, array $options = []): Client
    {
        return new Client($apiKey, $options);
    }
}
