<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Topics — granular subscription channels (e.g. "Product updates").
 * DOMAIN-FIRST: 'domain' is REQUIRED on create and list; topic names are
 * reusable across domains.
 */
class Topics extends Resource
{
    /**
     * Create a topic on a sending domain. POST /topics
     *
     * @param array $payload ['domain' => REQUIRED, 'name' => …,
     *                       'default_subscription' => 'opt_in'|'opt_out',
     *                       'visibility' => 'public'|'private',
     *                       'description' => …]
     */
    public function create(array $payload): array
    {
        return $this->client->request('POST', '/topics', $payload);
    }

    /** Retrieve a topic. GET /topics/:id */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/topics/' . Client::e($id));
    }

    /**
     * List a domain's topics ('domain' is REQUIRED). GET /topics?domain=…
     *
     * @param array $params ['domain' => REQUIRED, 'limit' => …, 'after' => …, 'before' => …]
     */
    public function list(array $params): array
    {
        return $this->client->request('GET', '/topics' . $this->paginationQuery($params, ['domain']));
    }

    /** Update a topic. PATCH /topics/:id */
    public function update(string $id, array $payload): array
    {
        return $this->client->request('PATCH', '/topics/' . Client::e($id), $payload);
    }

    /** Delete a topic. DELETE /topics/:id */
    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/topics/' . Client::e($id));
    }
}
