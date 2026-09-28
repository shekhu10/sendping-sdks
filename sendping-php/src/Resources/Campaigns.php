<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Campaigns — bulk sends to a domain's contact pool (or a segment of it).
 * DOMAIN-FIRST: 'domain' is REQUIRED on create and picks the contact pool the
 * campaign targets (orthogonal to 'from', which may be a different verified
 * domain).
 */
class Campaigns extends Resource
{
    /**
     * Create a campaign. POST /campaigns
     *
     * @param array $payload domain (REQUIRED), from, subject, html/text,
     *                       reply_to, preview_text, name, segment_id, topic_id,
     *                       recurrence, recurrence_every, ab_test, followups,
     *                       list_to, unsubscribe_policy, send, scheduled_at,
     *                       schedule_timezone (IANA zone the schedule + daily
     *                       batching are evaluated in), daily_batch_size (max
     *                       recipients per batch-day, 1-100000).
     */
    public function create(array $payload): array
    {
        return $this->client->request('POST', '/campaigns', $payload);
    }

    /** Retrieve a campaign (includes statistics). GET /campaigns/:id */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/campaigns/' . Client::e($id));
    }

    /**
     * List campaigns. GET /campaigns
     *
     * @param array $params Cursor pagination: limit, after, before.
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/campaigns' . $this->paginationQuery($params));
    }

    /**
     * Update a draft campaign. PATCH /campaigns/:id
     *
     * @param array $payload The create-side fields plus followups (replace
     *                       pending follow-ups; [] clears), list_to (bool),
     *                       unsubscribe_policy ('account'|'domain'|'ignore'),
     *                       schedule_timezone (IANA zone; null clears), and
     *                       daily_batch_size (1-100000; null clears).
     */
    public function update(string $id, array $payload): array
    {
        return $this->client->request('PATCH', '/campaigns/' . Client::e($id), $payload);
    }

    /**
     * Send now, or schedule with ['scheduled_at' => …]. An optional
     * 'schedule_timezone' (IANA name) is persisted onto the campaign so daily
     * batching evaluates batch-days in that zone. POST /campaigns/:id/send
     */
    public function send(string $id, array $payload = []): array
    {
        return $this->client->request('POST', '/campaigns/' . Client::e($id) . '/send', $payload);
    }

    /**
     * Stop a campaign's remaining work. POST /campaigns/:id/cancel
     *
     * Accepted only on 'scheduled', 'recurring', 'paused' and 'queued'; any
     * other status is a validation_error. The resulting status depends on how
     * far the send got, so read ['status'] rather than assuming:
     *  - 'scheduled' / 'recurring' / 'paused' → back to 'draft': the pending
     *    job (next occurrence included) is dropped and the campaign can be
     *    edited and sent again.
     *  - 'queued' (already fanning out) → 'canceled', which is TERMINAL. Part
     *    of the audience has been mailed and those copies cannot be recalled;
     *    what this stops is every remaining recipient — for a staggered
     *    campaign, every future batch-day. A canceled campaign can NOT be
     *    re-sent.
     */
    public function cancel(string $id): array
    {
        return $this->client->request('POST', '/campaigns/' . Client::e($id) . '/cancel');
    }

    /** Per-campaign analytics (counts, engagement rates, top 50 links). GET /campaigns/:id/stats */
    public function stats(string $id): array
    {
        return $this->client->request('GET', '/campaigns/' . Client::e($id) . '/stats');
    }

    /**
     * Who opened, clicked and replied — the per-contact rows behind
     * {@see stats()}. Not paginated; each list is capped at 500 rows.
     * GET /campaigns/:id/engagement
     */
    public function engagement(string $id): array
    {
        return $this->client->request('GET', '/campaigns/' . Client::e($id) . '/engagement');
    }

    /** A/B winner evaluation for an A/B campaign. GET /campaigns/:id/ab */
    public function ab(string $id): array
    {
        return $this->client->request('GET', '/campaigns/' . Client::e($id) . '/ab');
    }

    /** Delete a campaign. DELETE /campaigns/:id */
    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/campaigns/' . Client::e($id));
    }
}
