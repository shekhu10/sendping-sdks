<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Read-only results of the in-email poll widget.
 */
class Polls extends Resource
{
    /**
     * One summary row per email that has poll responses. GET /polls
     *
     * @param array $params Cursor pagination: limit, after, before.
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/polls' . $this->paginationQuery($params));
    }

    /** The aggregated answer breakdown for one email. GET /polls/:emailId */
    public function get(string $emailId): array
    {
        return $this->client->request('GET', '/polls/' . Client::e($emailId));
    }
}
