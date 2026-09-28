using System.Text.Json;

namespace SendPing;

public partial class SendPingClient
{
    // ---- Domains ----

    public Task<DomainTrackingHealth> DomainTrackingHealthAsync(string domainId, CancellationToken cancellationToken = default)
        => RequestAsync<DomainTrackingHealth>(HttpMethod.Get, $"/domains/{E(domainId)}/tracking-health", null, null, cancellationToken);

    public Task<Domain> DomainCreateAsync(DomainCreateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<Domain>(HttpMethod.Post, "/domains", options, null, cancellationToken);
    }

    public Task<Domain> DomainRetrieveAsync(string domainId, CancellationToken cancellationToken = default)
        => RequestAsync<Domain>(HttpMethod.Get, $"/domains/{E(domainId)}", null, null, cancellationToken);

    public Task<ListResponse<Domain>> DomainListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<Domain>>(HttpMethod.Get, "/domains" + Paginate(pagination), null, null, cancellationToken);

    public Task<ObjectRef> DomainUpdateAsync(string domainId, DomainUpdateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<ObjectRef>(HttpMethod.Patch, $"/domains/{E(domainId)}", options, null, cancellationToken);
    }

    public Task<ObjectRef> DomainVerifyAsync(string domainId, CancellationToken cancellationToken = default)
        => RequestAsync<ObjectRef>(HttpMethod.Post, $"/domains/{E(domainId)}/verify", null, null, cancellationToken);

    public Task<MxCheckResult> DomainMxCheckAsync(string domainName, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(domainName);
        return RequestAsync<MxCheckResult>(HttpMethod.Get, "/domains/mx-check" + Query(("name", domainName)), null, null, cancellationToken);
    }

    public Task<string> DomainRetrieveRecordsCsvAsync(string domainId, CancellationToken cancellationToken = default)
        => RequestTextAsync(HttpMethod.Get, $"/domains/{E(domainId)}/records.csv", cancellationToken);

    public Task<DomainClaim> DomainClaimAsync(DomainClaimOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<DomainClaim>(HttpMethod.Post, "/domains/claim", options, null, cancellationToken);
    }

    public Task<DomainClaim> DomainRetrieveClaimAsync(string domainId, CancellationToken cancellationToken = default)
        => RequestAsync<DomainClaim>(HttpMethod.Get, $"/domains/{E(domainId)}/claim", null, null, cancellationToken);

    public Task<DomainClaim> DomainVerifyClaimAsync(string domainId, CancellationToken cancellationToken = default)
        => RequestAsync<DomainClaim>(HttpMethod.Post, $"/domains/{E(domainId)}/claim/verify", null, null, cancellationToken);

    public Task<DnsDetectionResult> DomainDetectDnsAsync(string domainId, CancellationToken cancellationToken = default)
        => RequestAsync<DnsDetectionResult>(HttpMethod.Get, $"/domains/{E(domainId)}/dns/detect", null, null, cancellationToken);

    public Task<JsonElement> DomainApplyCloudflareDnsAsync(string domainId, string apiToken, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(apiToken);
        var body = new Dictionary<string, string> { ["token"] = apiToken };
        return RequestAsync<JsonElement>(HttpMethod.Post, $"/domains/{E(domainId)}/dns/cloudflare", body, null, cancellationToken);
    }

    public Task<JsonElement> DomainApplyGoDaddyDnsAsync(string domainId, string apiKey, string apiSecret, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(apiKey);
        ArgumentNullException.ThrowIfNull(apiSecret);
        var body = new Dictionary<string, string> { ["key"] = apiKey, ["secret"] = apiSecret };
        return RequestAsync<JsonElement>(HttpMethod.Post, $"/domains/{E(domainId)}/dns/godaddy", body, null, cancellationToken);
    }

    public Task<JsonElement> DomainApplyNamecheapDnsAsync(string domainId, NamecheapDnsCredentials credentials, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(credentials);
        return RequestAsync<JsonElement>(HttpMethod.Post, $"/domains/{E(domainId)}/dns/namecheap", credentials, null, cancellationToken);
    }

    public Task<RemovedResponse> DomainDeleteAsync(string domainId, CancellationToken cancellationToken = default)
        => RequestAsync<RemovedResponse>(HttpMethod.Delete, $"/domains/{E(domainId)}", null, null, cancellationToken);
}
