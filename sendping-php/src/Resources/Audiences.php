<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Audiences. Note the domain-first model: each sending domain also has its own
 * auto-managed contact POOL audience (its `domain` field names the domain).
 */
class Audiences extends Resource
{
    /**
     * Create an audience. POST /audiences
     *
     * @param array $payload ['name' => …]
     */
    public function create(array $payload): array
    {
        return $this->client->request('POST', '/audiences', $payload);
    }

    /** Retrieve an audience. GET /audiences/:id */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/audiences/' . Client::e($id));
    }

    /**
     * List audiences. GET /audiences
     *
     * @param array $params Cursor pagination: limit, after, before.
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/audiences' . $this->paginationQuery($params));
    }

    /**
     * Import contacts from a link-shared Google Sheet. Header columns become
     * contact properties (usable as {{merge_tags}}); rows land in a fresh
     * segment. POST /audiences/:id/contacts/import-sheet
     *
     * @param array $payload ['url' => sheet URL, 'segment_name' => …]
     */
    public function importSheet(string $audienceId, array $payload): array
    {
        return $this->client->request(
            'POST',
            '/audiences/' . Client::e($audienceId) . '/contacts/import-sheet',
            $payload
        );
    }

    /**
     * Rename an audience. PATCH /audiences/:id
     *
     * @param array $payload ['name' => …]
     */
    public function update(string $id, array $payload): array
    {
        return $this->client->request('PATCH', '/audiences/' . Client::e($id), $payload);
    }

    /** Delete an audience. DELETE /audiences/:id */
    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/audiences/' . Client::e($id));
    }
}
