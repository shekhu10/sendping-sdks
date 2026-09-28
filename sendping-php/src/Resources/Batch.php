<?php

declare(strict_types=1);

namespace SendPing\Resources;

/**
 * Batch send — `$sendping->batch->send([...])`.
 */
class Batch extends Resource
{
    /**
     * Send up to 100 emails in one request. POST /emails/batch
     *
     * Batch items reject 'attachments' and 'scheduled_at' — send those
     * individually via `$sendping->emails->send()`.
     *
     * A batch is served one of two ways, chosen by SIZE alone, and BOTH are
     * success statuses — branch on the response, never on "no exception was
     * thrown":
     *  - 1-40 emails are sent INLINE (HTTP 200). The returned array has NO
     *    'queued' key at all — absent, never false. Every id in ['data'] has
     *    already been handed to the mail service.
     *  - 41-100 emails are QUEUED for the worker (HTTP 202). The array then
     *    also carries 'queued' => true and 'queued_count' (=== the number of
     *    ['data'] rows). The ids are real, but the emails are still
     *    'scheduled' and NOTHING has been transmitted yet; the worker sends
     *    them on its next tick. Test it with `$res['queued'] ?? false`.
     * A batch carrying an @test.sendping.co simulator recipient (in to, cc or
     * bcc) stays inline at any size.
     *
     * @param array $payloads A list of send-email payloads.
     * @param array $options  'idempotencyKey' to safely retry.
     * @return array Always 'data'; plus 'queued' and 'queued_count' when queued.
     */
    public function send(array $payloads, array $options = []): array
    {
        return $this->client->request('POST', '/emails/batch', $payloads, $options);
    }
}
