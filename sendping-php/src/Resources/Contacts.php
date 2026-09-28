<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Contacts are DOMAIN-FIRST: each sending domain has its own contact pool (the
 * same address on two domains is two records with separate consent).
 *
 * - Pass 'domain' to use the flat `/contacts` API (REQUIRED there on
 *   create/list; on get/update/remove it disambiguates an EMAIL id across pools).
 * - Pass 'audienceId' instead to target a specific audience via the nested
 *   `/audiences/:id/contacts` API.
 */
class Contacts extends Resource
{
    /**
     * Create a contact. POST /contacts (flat, 'domain' required) or
     * POST /audiences/:id/contacts (when 'audienceId' is given).
     * Returns the slim ack ['object' => 'contact', 'id' => …].
     *
     * @param array $params domain|audienceId + email (required), first_name,
     *                      last_name, unsubscribed, properties.
     */
    public function create(array $params): array
    {
        $audienceId = $params['audienceId'] ?? null;
        unset($params['audienceId']);
        if ($audienceId !== null) {
            // The nested audience route derives its pool from the path; only
            // the flat route takes `domain` in the body.
            unset($params['domain']);
            return $this->client->request('POST', '/audiences/' . Client::e((string) $audienceId) . '/contacts', $params);
        }
        return $this->client->request('POST', '/contacts', $params);
    }

    /**
     * Retrieve a contact by id or email. An id is exact; an EMAIL can exist in
     * several domains' pools, so pass 'domain' to pick the pool (omitted → the
     * oldest match anywhere).
     *
     * @param array $params ['id' => contact id or email, 'domain' => …, 'audienceId' => …]
     */
    public function get(array $params): array
    {
        $id = Client::e((string) ($params['id'] ?? ''));
        if (!empty($params['audienceId'])) {
            return $this->client->request(
                'GET',
                '/audiences/' . Client::e((string) $params['audienceId']) . '/contacts/' . $id
            );
        }
        $qs = isset($params['domain']) ? '?domain=' . rawurlencode((string) $params['domain']) : '';
        return $this->client->request('GET', '/contacts/' . $id . $qs);
    }

    /**
     * List contacts. Domain-first: 'domain' is required on the flat `/contacts`
     * list (names the pool); pass 'audienceId' for the nested list instead.
     * 'segment_id' restricts to members of that segment (both APIs).
     *
     * @param array $params domain|audienceId, limit, after, before, segment_id.
     */
    public function list(array $params = []): array
    {
        $audienceId = $params['audienceId'] ?? null;
        $query = [];
        if ($audienceId === null && isset($params['domain'])) {
            $query['domain'] = $params['domain'];
        }
        foreach (['limit', 'after', 'before', 'segment_id'] as $key) {
            if (isset($params[$key])) {
                $query[$key] = $params[$key];
            }
        }
        $base = $audienceId !== null
            ? '/audiences/' . Client::e((string) $audienceId) . '/contacts'
            : '/contacts';
        return $this->client->request('GET', $base . $this->client->query($query));
    }

    /**
     * Bulk-import contacts from an array. Upserts by email; max 10,000 per
     * call. Domain-first, like create(): pass 'domain' for the flat
     * POST /contacts/batch, or 'audienceId' for
     * POST /audiences/:id/contacts/batch.
     *
     * Prefer this over a create() loop for many contacts: one batch takes the
     * account's contact-limit lock once, a loop takes it per contact.
     *
     * @param array $params ['domain' => … | 'audienceId' => …,
     *                      'contacts' => [ … ],
     *                      'on_conflict' => 'upsert'|'skip' ('skip' leaves
     *                      existing contacts untouched; default 'upsert')]
     */
    public function batch(array $params): array
    {
        $qs = isset($params['on_conflict'])
            ? '?on_conflict=' . rawurlencode((string) $params['on_conflict'])
            : '';
        $body = ['contacts' => $params['contacts'] ?? []];
        if (!empty($params['audienceId'])) {
            return $this->client->request(
                'POST',
                '/audiences/' . Client::e((string) $params['audienceId']) . '/contacts/batch' . $qs,
                $body
            );
        }
        // The nested route derives its pool from the path; only the flat route
        // takes 'domain' (in the body, same as POST /contacts).
        if (isset($params['domain'])) {
            $body['domain'] = $params['domain'];
        }
        return $this->client->request('POST', '/contacts/batch' . $qs, $body);
    }

    /**
     * Bulk-import contacts from CSV. Upserts by email. By default every
     * non-builtin CSV column is auto-registered as a custom property (so
     * `company`, `plan`, … survive and become {{merge}} tags); pass
     * 'create_properties' => false for strict mode.
     * POST /audiences/:id/contacts/import
     *
     * Two input modes: inline 'csv' text (max 5 MB / 10,000 rows), or
     * 'storage_key' from {@see createImportUpload()} for a file uploaded straight to
     * storage (no size limit beyond the upload cap; rows beyond the account's
     * remaining contact capacity are reported as limit_skipped instead of
     * failing).
     *
     * @param array $params ['audienceId' => …,
     *                      'csv' => … OR 'storage_key' => …,
     *                      'file_name' => name recorded for the inline CSV,
     *                      'on_conflict' => 'upsert'|'skip',
     *                      'create_properties' => bool,
     *                      'segment_id' => add every imported email to this
     *                      segment (must belong to the same audience)]
     */
    public function import(array $params): array
    {
        $query = [];
        if (isset($params['on_conflict'])) {
            $query['on_conflict'] = $params['on_conflict'];
        }
        if (($params['create_properties'] ?? null) === false) {
            $query['create_properties'] = 'false';
        }
        if (isset($params['segment_id'])) {
            $query['segment_id'] = $params['segment_id'];
        }

        $body = [];
        foreach (['csv', 'storage_key', 'file_name'] as $key) {
            if (isset($params[$key])) {
                $body[$key] = $params[$key];
            }
        }
        if ($body === []) {
            $body['csv'] = '';
        }

        return $this->client->request(
            'POST',
            '/audiences/' . Client::e((string) $params['audienceId']) . '/contacts/import' . $this->client->query($query),
            $body
        );
    }

    /**
     * Mint a presigned URL for uploading a CSV straight to storage, so a large
     * file never passes through the API. PUT the file to the returned
     * 'upload_url', then hand the returned 'storage_key' to {@see import()}.
     * POST /audiences/:id/contacts/import/upload
     *
     * The returned 'upload_url' is a bearer credential — do not log it.
     *
     * @param array $params ['audienceId' => …, 'filename' => must end in .csv,
     *                      'size' => file size in bytes (max 256 MB)]
     */
    public function createImportUpload(array $params): array
    {
        $body = [];
        foreach (['filename', 'size'] as $key) {
            if (isset($params[$key])) {
                $body[$key] = $params[$key];
            }
        }
        return $this->client->request(
            'POST',
            '/audiences/' . Client::e((string) $params['audienceId']) . '/contacts/import/upload',
            $body
        );
    }

    /**
     * Update a contact. Returns the slim ack ['object' => 'contact', 'id' => …].
     * On the flat API, pass 'domain' when 'id' is an EMAIL (disambiguates
     * across pools).
     *
     * @param array $params ['id' => contact id or email, 'audienceId' => …,
     *                      'domain' => …] + first_name, last_name,
     *                      unsubscribed, properties.
     */
    public function update(array $params): array
    {
        $id = (string) ($params['id'] ?? '');
        $audienceId = $params['audienceId'] ?? null;
        unset($params['id'], $params['audienceId']);
        if ($audienceId !== null) {
            // The nested audience route derives its pool from the path; the
            // flat route takes an optional `domain` in the body.
            unset($params['domain']);
            return $this->client->request(
                'PATCH',
                '/audiences/' . Client::e((string) $audienceId) . '/contacts/' . Client::e($id),
                $params
            );
        }
        return $this->client->request('PATCH', '/contacts/' . Client::e($id), $params);
    }

    /**
     * Delete a contact. On the flat API, pass 'domain' when 'id' is an EMAIL
     * (disambiguates across pools).
     *
     * @param array $params ['id' => contact id or email, 'domain' => …, 'audienceId' => …]
     */
    public function remove(array $params): array
    {
        $id = Client::e((string) ($params['id'] ?? ''));
        if (!empty($params['audienceId'])) {
            return $this->client->request(
                'DELETE',
                '/audiences/' . Client::e((string) $params['audienceId']) . '/contacts/' . $id
            );
        }
        $qs = isset($params['domain']) ? '?domain=' . rawurlencode((string) $params['domain']) : '';
        return $this->client->request('DELETE', '/contacts/' . $id . $qs);
    }

    /** Add a contact to a segment. POST /contacts/:id/segments/:segmentId */
    public function addToSegment(string $id, string $segmentId): array
    {
        return $this->client->request(
            'POST',
            '/contacts/' . Client::e($id) . '/segments/' . Client::e($segmentId)
        );
    }

    /** Remove a contact from a segment. DELETE /contacts/:id/segments/:segmentId */
    public function removeFromSegment(string $id, string $segmentId): array
    {
        return $this->client->request(
            'DELETE',
            '/contacts/' . Client::e($id) . '/segments/' . Client::e($segmentId)
        );
    }

    /**
     * List the segments a contact belongs to. GET /contacts/:id/segments
     *
     * @param array $params Optional cursor pagination (limit, after, before).
     *                      With no params the list comes back in ONE page
     *                      instead of a 20-row one, still capped at 1000 rows
     *                      with 'has_more' reporting the truncation.
     */
    public function listSegments(string $id, array $params = []): array
    {
        return $this->client->request(
            'GET',
            '/contacts/' . Client::e($id) . '/segments' . $this->paginationQuery($params)
        );
    }

    /**
     * Get a contact's topic subscriptions. GET /contacts/:id/topics
     *
     * @param array $params Optional cursor pagination (limit, after, before).
     *                      With no params the list comes back in ONE page
     *                      instead of a 20-row one, still capped at 1000 rows
     *                      with 'has_more' reporting the truncation.
     */
    public function getTopics(string $id, array $params = []): array
    {
        return $this->client->request(
            'GET',
            '/contacts/' . Client::e($id) . '/topics' . $this->paginationQuery($params)
        );
    }

    /**
     * Update a contact's topic subscriptions. PATCH /contacts/:id/topics
     *
     * @param array $payload ['topics' => [['id' => …, 'subscription' => 'opt_in'|'opt_out'], …]]
     */
    public function updateTopics(string $id, array $payload): array
    {
        return $this->client->request('PATCH', '/contacts/' . Client::e($id) . '/topics', $payload);
    }
}
