<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;
use SendPing\WebhookSignature;

/**
 * Webhooks — endpoint management plus a local signature verify helper.
 */
class Webhooks extends Resource
{
    /**
     * Create a webhook. POST /webhooks
     * The plaintext 'signing_secret' is returned ONCE, only here.
     *
     * @param array $payload ['endpoint' => URL, 'events' => ['email.delivered', …],
     *                       'secret' => optional caller-supplied signing secret]
     */
    public function create(array $payload): array
    {
        return $this->client->request('POST', '/webhooks', $payload);
    }

    /** Retrieve a webhook. GET /webhooks/:id */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/webhooks/' . Client::e($id));
    }

    /**
     * List webhooks. GET /webhooks
     *
     * @param array $params Cursor pagination: limit, after, before.
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/webhooks' . $this->paginationQuery($params));
    }

    /**
     * Update a webhook (endpoint/events/status). PATCH /webhooks/:id
     * Returns the slim ack ['object' => 'webhook', 'id' => …].
     */
    public function update(string $id, array $payload): array
    {
        return $this->client->request('PATCH', '/webhooks/' . Client::e($id), $payload);
    }

    /**
     * Rotate the signing secret. The new plaintext 'signing_secret' is returned
     * ONCE (reveal-once); the old secret stops verifying immediately.
     * POST /webhooks/:id/rotate
     */
    public function rotate(string $id): array
    {
        return $this->client->request('POST', '/webhooks/' . Client::e($id) . '/rotate');
    }

    /**
     * Send a synchronous test delivery and return the endpoint's live result.
     * POST /webhooks/:id/test
     *
     * A FAILED delivery is still HTTP 200, so this does NOT throw when your
     * endpoint rejects the test — the outcome is `ok`:
     *
     *     $result = $mb->webhooks->test($id);
     *     if (!$result['ok']) {
     *         error_log("test delivery failed: {$result['error']}");
     *     }
     *
     * `status` is your endpoint's HTTP status when it responded at all;
     * `error` says why the delivery failed (e.g. 'lookup_failed',
     * 'webhook missing or disabled'). It is a single attempt — no retries are
     * scheduled.
     *
     * @return array{object: string, id: string, ok: bool, status?: int, error?: string}
     */
    public function test(string $id): array
    {
        return $this->client->request('POST', '/webhooks/' . Client::e($id) . '/test');
    }

    /** Delete a webhook. DELETE /webhooks/:id */
    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/webhooks/' . Client::e($id));
    }

    /**
     * Verify a webhook delivery's Svix-style signature against your endpoint's
     * signing secret (`{id}.{timestamp}.{body}` → base64 HMAC-SHA256, tagged
     * `v1,`). A pure local computation — makes no HTTP request.
     *
     * `$payload` MUST be the exact raw request body string the server sent.
     * See {@see WebhookSignature::verify()} for details.
     *
     * @return array{valid: bool, reason?: string}
     */
    public function verify(string $payload, array $headers, string $secret, array $options = []): array
    {
        return WebhookSignature::verify($payload, $headers, $secret, $options);
    }
}
