<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Email templates (draft/publish lifecycle, {{ variables }}, aliases).
 *
 * Every `/templates/:id` route accepts either the template id or its `alias`.
 */
class Templates extends Resource
{
    /**
     * Create a template. POST /templates
     * Returns the slim ack ['object' => 'template', 'id' => …].
     *
     * @param array $payload name (required, max 255), alias (max 255, unique
     *                       per account), subject (max 998), from (max 320),
     *                       reply_to (max 320), html, text, variables (max 50;
     *                       [['key' => …, 'type' => 'string'|'number',
     *                       'fallback_value' => …], …]). At least one of
     *                       html/text is required. New templates start as
     *                       drafts — sends use the published snapshot, so call
     *                       {@see publish()} before sending.
     */
    public function create(array $payload): array
    {
        return $this->client->request('POST', '/templates', $payload);
    }

    /** Retrieve a template. GET /templates/:id */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/templates/' . Client::e($id));
    }

    /**
     * List templates. GET /templates
     *
     * @param array $params Cursor pagination: limit, after, before.
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/templates' . $this->paginationQuery($params));
    }

    /**
     * Update a template (creates a new draft version). PATCH /templates/:id
     * Returns the slim ack ['object' => 'template', 'id' => …].
     */
    public function update(string $id, array $payload): array
    {
        return $this->client->request('PATCH', '/templates/' . Client::e($id), $payload);
    }

    /**
     * Duplicate a template. POST /templates/:id/duplicate
     *
     * @param array $payload Optional ['name' => …, 'alias' => …].
     */
    public function duplicate(string $id, array $payload = []): array
    {
        return $this->client->request('POST', '/templates/' . Client::e($id) . '/duplicate', $payload);
    }

    /** Publish a template (make its latest draft live). POST /templates/:id/publish */
    public function publish(string $id): array
    {
        return $this->client->request('POST', '/templates/' . Client::e($id) . '/publish');
    }

    /** Delete a template. DELETE /templates/:id */
    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/templates/' . Client::e($id));
    }
}
