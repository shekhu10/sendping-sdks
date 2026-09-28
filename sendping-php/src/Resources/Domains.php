<?php

declare(strict_types=1);

namespace SendPing\Resources;

use SendPing\Client;

/**
 * Domains — verification, claiming, and one-click DNS apply.
 */
class Domains extends Resource
{
    /** HTTPS readiness; an unavailable host schedules server-side repair. */
    public function trackingHealth(string $id): array
    {
        return $this->client->request('GET', '/domains/' . Client::e($id) . '/tracking-health');
    }

    /**
     * Add a sending domain. POST /domains
     *
     * @param array $payload name (required), region, custom_return_path,
     *                       open_tracking, click_tracking, tracking_subdomain,
     *                       tls ('opportunistic'|'enforced'),
     *                       capabilities (e.g. ['receiving' => 'enabled']).
     */
    public function create(array $payload): array
    {
        return $this->client->request('POST', '/domains', $payload);
    }

    /** Retrieve a domain (status + DNS records). GET /domains/:id */
    public function get(string $id): array
    {
        return $this->client->request('GET', '/domains/' . Client::e($id));
    }

    /**
     * List domains. GET /domains
     *
     * Domains still awaiting a DNS-TXT ownership claim are NOT included — read
     * those with {@see getClaim()}.
     *
     * @param array $params Optional cursor pagination (limit, after, before).
     *                      With no params the endpoint answers in ONE page
     *                      instead of a 20-row one, but it is still capped at
     *                      1000 rows — 'has_more' reports the truncation, so
     *                      keep paging with 'after' rather than assuming the
     *                      first response is complete.
     */
    public function list(array $params = []): array
    {
        return $this->client->request('GET', '/domains' . $this->paginationQuery($params));
    }

    /**
     * Look up a domain's live MX records — 'ours' is true only when every MX
     * host points at SendPing. Fails open: a DNS failure returns
     * has_mx/ours false with an empty record list. GET /domains/mx-check
     */
    public function mxCheck(string $name): array
    {
        return $this->client->request('GET', '/domains/mx-check' . $this->client->query(['name' => $name]));
    }

    /**
     * Download this domain's DNS records as CSV text (not JSON), ready to hand
     * to a DNS provider's bulk importer. GET /domains/:id/records.csv
     */
    public function recordsCsv(string $id): string
    {
        return $this->client->requestRaw('GET', '/domains/' . Client::e($id) . '/records.csv');
    }

    /**
     * Update a domain's tracking/TLS/capabilities settings. PATCH /domains/:id
     * Returns the slim ack ['object' => 'domain', 'id' => …].
     */
    public function update(string $id, array $payload): array
    {
        return $this->client->request('PATCH', '/domains/' . Client::e($id), $payload);
    }

    /**
     * Trigger DNS verification. POST /domains/:id/verify
     * Returns the slim ack ['object' => 'domain', 'id' => …].
     */
    public function verify(string $id): array
    {
        return $this->client->request('POST', '/domains/' . Client::e($id) . '/verify');
    }

    /**
     * Claim a domain already verified by another account. POST /domains/claim
     *
     * @param array $payload ['name' => 'example.com', 'region' => …]
     */
    public function claim(array $payload): array
    {
        return $this->client->request('POST', '/domains/claim', $payload);
    }

    /** Retrieve a domain's claim record. GET /domains/:id/claim */
    public function getClaim(string $id): array
    {
        return $this->client->request('GET', '/domains/' . Client::e($id) . '/claim');
    }

    /** Verify a domain claim (checks the claim TXT record). POST /domains/:id/claim/verify */
    public function verifyClaim(string $id): array
    {
        return $this->client->request('POST', '/domains/' . Client::e($id) . '/claim/verify');
    }

    /**
     * Detect a domain's DNS provider and the one-click apply methods available
     * (Cloudflare token, GoDaddy key/secret, hosted Domain Connect, panel
     * deep-link). GET /domains/:id/dns/detect
     */
    public function detectDns(string $id): array
    {
        return $this->client->request('GET', '/domains/' . Client::e($id) . '/dns/detect');
    }

    /**
     * Apply this domain's DNS records via the Cloudflare API, then auto-verify.
     * POST /domains/:id/dns/cloudflare
     *
     * @param array $payload ['token' => Cloudflare API token]
     */
    public function applyCloudflareDns(string $id, array $payload): array
    {
        return $this->client->request('POST', '/domains/' . Client::e($id) . '/dns/cloudflare', $payload);
    }

    /**
     * Apply this domain's DNS records via the GoDaddy API, then auto-verify.
     * POST /domains/:id/dns/godaddy
     *
     * @param array $payload ['key' => …, 'secret' => …]
     */
    public function applyGoDaddyDns(string $id, array $payload): array
    {
        return $this->client->request('POST', '/domains/' . Client::e($id) . '/dns/godaddy', $payload);
    }

    /**
     * Apply this domain's DNS records via the Namecheap API (existing records
     * are preserved), then auto-verify. Namecheap must have the calling
     * server's IP whitelisted in the account's API settings.
     * POST /domains/:id/dns/namecheap
     *
     * @param array $payload ['apiUser' => …, 'apiKey' => …, 'userName' => …]
     */
    public function applyNamecheapDns(string $id, array $payload): array
    {
        return $this->client->request('POST', '/domains/' . Client::e($id) . '/dns/namecheap', $payload);
    }

    /** Delete a domain. DELETE /domains/:id */
    public function remove(string $id): array
    {
        return $this->client->request('DELETE', '/domains/' . Client::e($id));
    }
}
