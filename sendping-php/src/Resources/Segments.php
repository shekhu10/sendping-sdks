<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Segments. DOMAIN-FIRST: 'domain' is REQUIRED on create and list — segment
 * names are unique within a domain (reusable across domains), and every domain
 * carries an auto-created "General" (all contacts) segment.
 */
class Segments extends Resource
{
    /**
     * Create a segment on a sending domain. POST /segments
     *
     * @param array $payload ['domain' => REQUIRED, 'name' => …,
     *                       'filter' => ['status' => 'all'|'subscribed'|'unsubscribed'|'members_only',
     *                                    'email_contains' => …,
     *                                    'property_filters' => [['key' => …, 'operator' => 'eq'|'contains'|'exists', 'value' => …], …],
     *                                    'engagement' => ['event' => 'opened'|'not_opened'|'clicked'|'not_clicked',
     *                                                     'campaign_id' => …]]]
     *                       Every filter field is also accepted at the top
     *                       level; a nested one wins.
     */
    public function create(array $payload): array
    {
        return $this->client->request('POST', '/segments', $payload);
    }

    /** Retrieve a segment. GET /segments/:id */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/segments/' . Client::e($id));
    }

    /**
     * List a domain's segments ('domain' is REQUIRED; includes its
     * auto-created "General" segment). GET /segments?domain=…
     *
     * @param array $params ['domain' => REQUIRED, 'limit' => …, 'after' => …, 'before' => …]
     */
    public function list(array $params): array
    {
        return $this->client->request('GET', '/segments' . $this->paginationQuery($params, ['domain']));
    }

    /**
     * Preview the contacts a segment currently resolves to (filter matches plus
     * explicit memberships). GET /segments/:id/contacts
     *
     * @param array $params Optional cursor pagination (limit, after, before).
     *                      With no params the preview comes back in ONE page
     *                      rather than a 20-row one, but it is still capped at
     *                      1000 contacts — a segment can easily resolve to
     *                      more, so page with 'after' while 'has_more' is true
     *                      instead of treating the first response as the whole
     *                      segment.
     */
    public function contacts(string $id, array $params = []): array
    {
        return $this->client->request(
            'GET',
            '/segments/' . Client::e($id) . '/contacts' . $this->paginationQuery($params)
        );
    }

    /**
     * Update a segment. A segment's domain cannot change — passing 'domain'
     * (or 'audience_id') at all is a 422. PATCH /segments/:id
     */
    public function update(string $id, array $payload): array
    {
        return $this->client->request('PATCH', '/segments/' . Client::e($id), $payload);
    }

    /** Delete a segment. DELETE /segments/:id */
    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/segments/' . Client::e($id));
    }
}
