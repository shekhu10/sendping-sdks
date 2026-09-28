<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Inbound (received) email — `$sendping->emails->receiving`.
 */
class ReceivingEmails extends Resource
{
    /**
     * List received emails. GET /emails/receiving
     *
     * @param array $params Cursor pagination (limit, after, before) plus an
     *                      optional received_for filter (only messages
     *                      received for that address). With no limit and no
     *                      cursor the endpoint returns up to 1000 rows in one
     *                      response instead of a 20-row page.
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/emails/receiving' . $this->paginationQuery($params, ['received_for']));
    }

    /**
     * Per-address inbound stats (totals, replies, last received).
     * Not paginated. GET /emails/receiving/addresses
     */
    public function listAddresses(): array
    {
        return $this->client->request('GET', '/emails/receiving/addresses');
    }

    /** Retrieve a received email. GET /emails/receiving/:id */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/emails/receiving/' . Client::e($id));
    }

    /**
     * List a received email's attachments. GET /emails/receiving/:id/attachments
     *
     * @param array $params Optional cursor pagination (limit, after, before).
     *                      With neither limit nor after the whole list comes
     *                      back in one page, still capped at 1000 rows;
     *                      'has_more' is true when that cap truncated it.
     */
    public function listAttachments(string $id, array $params = []): array
    {
        return $this->client->request(
            'GET',
            '/emails/receiving/' . Client::e($id) . '/attachments' . $this->paginationQuery($params)
        );
    }

    /**
     * Download one attachment of a received email as raw bytes.
     * GET /emails/receiving/:id/attachments/:attachmentId — this route streams
     * the binary file (not JSON), so a raw string is returned.
     */
    public function getAttachment(string $id, string $attachmentId): string
    {
        return $this->client->requestRaw(
            'GET',
            '/emails/receiving/' . Client::e($id) . '/attachments/' . Client::e($attachmentId)
        );
    }

    /**
     * Download the original RFC822/MIME message as raw bytes.
     * GET /emails/receiving/:id/raw — streams `message/rfc822` as a string.
     */
    public function getRaw(string $id): string
    {
        return $this->client->requestRaw('GET', '/emails/receiving/' . Client::e($id) . '/raw');
    }

    /**
     * Forward a received email. POST /emails/receiving/:id/forward
     *
     * @param array $payload ['from' => verified sender (required), 'to' => …, 'subject' => …]
     */
    public function forward(string $id, array $payload, array $options = []): array
    {
        return $this->client->request('POST', '/emails/receiving/' . Client::e($id) . '/forward', $payload, $options);
    }

    /**
     * Reply to a received email's sender, threaded into the same conversation
     * (In-Reply-To the received message; subject defaults to `Re: …`).
     * POST /emails/receiving/:id/reply
     *
     * @param array $payload ['from' => …, 'html' => …, 'text' => …, 'subject' => …]
     */
    public function reply(string $id, array $payload, array $options = []): array
    {
        return $this->client->request('POST', '/emails/receiving/' . Client::e($id) . '/reply', $payload, $options);
    }

    /** Delete a received email. DELETE /emails/receiving/:id */
    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/emails/receiving/' . Client::e($id));
    }
}
