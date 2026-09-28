<?php

declare(strict_types=1);

namespace SendPing\Resources;

/**
 * API keys — listing only, by design.
 *
 * Keys are created, re-scoped and revoked in the SendPing dashboard by a
 * signed-in user: POST /api-keys, PATCH /api-keys/:id and DELETE /api-keys/:id
 * answer 403 `dashboard_only` to every API-key caller, whatever its
 * permission. Exposing only list() means a leaked key cannot mint itself a
 * replacement or widen its own access.
 */
class ApiKeys extends Resource
{
    /**
     * List API keys (non-secret display prefixes only; revoked keys are
     * excluded). GET /api-keys
     *
     * @param array $params Optional cursor pagination (limit, after, before).
     *                      With no params the endpoint answers in ONE page
     *                      instead of a 20-row one, but it is still capped at
     *                      1000 rows and reports the truncation as
     *                      'has_more' => true.
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/api-keys' . $this->paginationQuery($params));
    }
}
