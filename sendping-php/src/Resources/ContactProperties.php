<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Contact properties (custom fields usable as {{merge_tags}}).
 */
class ContactProperties extends Resource
{
    /**
     * Register a contact property. POST /contact-properties
     * Returns the slim ack ['object' => 'contact_property', 'id' => …].
     *
     * @param array $payload ['key' => … ('name' accepted as an alias),
     *                       'type' => 'string'|'number', 'fallback_value' => …]
     */
    public function create(array $payload): array
    {
        return $this->client->request('POST', '/contact-properties', $payload);
    }

    /** Retrieve a contact property. GET /contact-properties/:id */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/contact-properties/' . Client::e($id));
    }

    /**
     * List contact properties. GET /contact-properties
     *
     * @param array $params Cursor pagination: limit, after, before.
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/contact-properties' . $this->paginationQuery($params));
    }

    /**
     * Update a contact property (only fallback_value is mutable; key/type are
     * immutable). PATCH /contact-properties/:id
     */
    public function update(string $id, array $payload): array
    {
        return $this->client->request('PATCH', '/contact-properties/' . Client::e($id), $payload);
    }

    /** Delete a contact property. DELETE /contact-properties/:id */
    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/contact-properties/' . Client::e($id));
    }
}
