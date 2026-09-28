<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * API request logs (read-only).
 */
class Logs extends Resource
{
    /**
     * List API request logs. Cursor-paginated with optional server-side
     * filters. GET /logs
     *
     * @param array $params limit, after, before, method (exact HTTP method,
     *                      e.g. 'POST'), status (exact response status, e.g. 429).
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/logs' . $this->paginationQuery($params, ['method', 'status']));
    }

    /** Retrieve a log entry (includes request/response bodies). GET /logs/:id */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/logs/' . Client::e($id));
    }
}
