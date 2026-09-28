<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Base class for API resources.
 */
abstract class Resource
{
    public function __construct(protected readonly Client $client)
    {
    }

    /**
     * Build a `?limit=&after=&before=` cursor-pagination query string from
     * params (plus any extra whitelisted keys).
     */
    protected function paginationQuery(array $params, array $extraKeys = []): string
    {
        $keys = array_merge(['limit', 'after', 'before'], $extraKeys);
        return $this->client->query(array_intersect_key($params, array_flip($keys)));
    }
}
