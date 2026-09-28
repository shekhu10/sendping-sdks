using System.Text.Json;

namespace SendPing;

public partial interface ISendPing
{
    // ---- Domains ----

    /// <summary>Create a sending domain. POST /domains</summary>
    /// <summary>Check tracking HTTPS readiness; unavailable hosts schedule repair.</summary>
    Task<DomainTrackingHealth> DomainTrackingHealthAsync(string domainId, CancellationToken cancellationToken = default);

    Task<Domain> DomainCreateAsync(DomainCreateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Retrieve a domain with its DNS records. GET /domains/:id</summary>
    Task<Domain> DomainRetrieveAsync(string domainId, CancellationToken cancellationToken = default);

    /// <summary>List domains. GET /domains</summary>
    Task<ListResponse<Domain>> DomainListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>Update a domain's tracking/TLS/capabilities settings. PATCH /domains/:id</summary>
    Task<ObjectRef> DomainUpdateAsync(string domainId, DomainUpdateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Trigger DNS verification of a domain. POST /domains/:id/verify</summary>
    Task<ObjectRef> DomainVerifyAsync(string domainId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Check the MX records currently published for a domain name before
    /// enabling inbound. Fails open — a lookup failure is a 200 with
    /// <c>HasMx = false</c>. GET /domains/mx-check
    /// </summary>
    Task<MxCheckResult> DomainMxCheckAsync(string domainName, CancellationToken cancellationToken = default);

    /// <summary>
    /// Download a domain's DNS records as CSV text (CRLF-terminated, header row
    /// <c>Type,Host,Full name,Value,Priority,TTL,Purpose,Status</c>).
    /// GET /domains/:id/records.csv
    /// </summary>
    Task<string> DomainRetrieveRecordsCsvAsync(string domainId, CancellationToken cancellationToken = default);

    /// <summary>Claim a domain already verified by another account. POST /domains/claim</summary>
    Task<DomainClaim> DomainClaimAsync(DomainClaimOptions options, CancellationToken cancellationToken = default);

    /// <summary>Retrieve a domain's claim record. GET /domains/:id/claim</summary>
    Task<DomainClaim> DomainRetrieveClaimAsync(string domainId, CancellationToken cancellationToken = default);

    /// <summary>Verify a domain claim (checks the claim TXT record). POST /domains/:id/claim/verify</summary>
    Task<DomainClaim> DomainVerifyClaimAsync(string domainId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Detect a domain's DNS provider and the one-click apply methods available
    /// (Cloudflare token, GoDaddy key/secret, hosted Domain Connect, panel deep-link).
    /// GET /domains/:id/dns/detect
    /// </summary>
    Task<DnsDetectionResult> DomainDetectDnsAsync(string domainId, CancellationToken cancellationToken = default);

    /// <summary>Apply this domain's DNS records via the Cloudflare API, then auto-verify. POST /domains/:id/dns/cloudflare</summary>
    Task<JsonElement> DomainApplyCloudflareDnsAsync(string domainId, string apiToken, CancellationToken cancellationToken = default);

    /// <summary>Apply this domain's DNS records via the GoDaddy API, then auto-verify. POST /domains/:id/dns/godaddy</summary>
    Task<JsonElement> DomainApplyGoDaddyDnsAsync(string domainId, string apiKey, string apiSecret, CancellationToken cancellationToken = default);

    /// <summary>
    /// Apply this domain's DNS records via the Namecheap API (existing records
    /// preserved), then auto-verify. Namecheap must have the calling server's IP
    /// whitelisted. POST /domains/:id/dns/namecheap
    /// </summary>
    Task<JsonElement> DomainApplyNamecheapDnsAsync(string domainId, NamecheapDnsCredentials credentials, CancellationToken cancellationToken = default);

    /// <summary>Delete a domain. DELETE /domains/:id</summary>
    Task<RemovedResponse> DomainDeleteAsync(string domainId, CancellationToken cancellationToken = default);
}
