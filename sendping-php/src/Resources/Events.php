<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Custom events — the triggers for automations.
 */
class Events extends Resource
{
    /**
     * Send a custom event that automations can trigger on. POST /events/send
     *
     * DOMAIN-FIRST: 'domain' is REQUIRED — only automations belonging to that
     * domain are triggered, and contacts auto-created by the event land in the
     * domain's own contact pool.
     *
     * @param array $payload ['event' => name ('name' accepted as an alias),
     *                       'domain' => REQUIRED,
     *                       'contact_id' => … OR 'email' => …,
     *                       'payload' => [ … ] ('data' accepted as an alias)]
     * @param array $options Per-request options. 'idempotencyKey' is still sent
     *                       as `Idempotency-Key`, but only send, batch, reply,
     *                       and forward honour that header
     *                       ({@see Client::IDEMPOTENCY_KEY_MAX_LENGTH}) — the
     *                       API ignores it here, so a retry ingests a SECOND
     *                       event and can enroll the contact twice. De-duplicate
     *                       on your side instead.
     */
    public function send(array $payload, array $options = []): array
    {
        return $this->client->request('POST', '/events/send', $payload, $options);
    }

    /**
     * Create a custom-event definition (name + optional payload schema).
     * Event names may not start with the reserved 'sendping:' prefix.
     * POST /events
     *
     * @param array $payload ['name' => …, 'schema' => ['key' => 'string'|'number'|'boolean'|'date', …]]
     * @param array $options Per-request options. 'idempotencyKey' carries no
     *                       guarantee here — see {@see send()}. A duplicate
     *                       event name is already a 422 validation_error.
     */
    public function create(array $payload, array $options = []): array
    {
        return $this->client->request('POST', '/events', $payload, $options);
    }

    /**
     * List custom-event definitions. GET /events
     *
     * @param array $params Cursor pagination: limit, after, before.
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/events' . $this->paginationQuery($params));
    }

    /**
     * Update a custom-event definition's payload schema. PATCH /events/:id
     *
     * An event's name is immutable (automations reference it) — sending 'name'
     * is a 422. Pass ['schema' => null] to clear the schema.
     *
     * @param array $payload ['schema' => ['key' => 'string'|'number'|'boolean'|'date', …] | null]
     */
    public function update(string $id, array $payload): array
    {
        return $this->client->request('PATCH', '/events/' . Client::e($id), $payload);
    }

    /** Delete a custom-event definition. DELETE /events/:id */
    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/events/' . Client::e($id));
    }
}
